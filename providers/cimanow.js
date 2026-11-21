/**
 * Nuvio Native Plugin - CimaNow Provider (v1.2.0)
 * يقرأ الدومين تلقائياً من ملف domains.json المركزي في جذر المستودع
 * متوافق مع بيئة Hermes / JavaScriptCore بدون أي مكتبات خارجية
 */

const CONFIG = {
  // ضع رابط ملف domains.json المباشر (Raw) من مستودعك على GitHub مرة واحدة فقط
  // مثال: 'https://raw.githubusercontent.com/USERNAME/nuvio-arabic-streams/main/domains.json'
  DOMAINS_URL: 'https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/domains.json',

  // الدومين الاحتياطي في حال تعذر الوصول إلى domains.json أو قبل تعديل الرابط بالأعلى
  FALLBACK_BASE_URL: 'https://cimanow.cc',

  // اختياري: مفتاح TMDB محلي (لو تركته فارغاً سيقرأ من tmdb_api_key داخل domains.json إن وجد)
  TMDB_API_KEY: '',

  // مدة الكاش للدومينات (30 دقيقة) لتسريع التشغيل وعدم تكرار الطلب مع كل فيلم
  DOMAINS_CACHE_TTL_MS: 30 * 60 * 1000,
  TIMEOUT_MS: 12000,
  MAX_AJAX_SERVERS: 4
};

const RUNTIME = {
  baseUrl: CONFIG.FALLBACK_BASE_URL.replace(/\/$/, ''),
  tmdbApiKey: CONFIG.TMDB_API_KEY,
  lastConfigFetch: 0
};

function getBaseUrl() {
  return (RUNTIME.baseUrl || CONFIG.FALLBACK_BASE_URL).replace(/\/$/, '');
}

function getTmdbApiKey() {
  return (CONFIG.TMDB_API_KEY || RUNTIME.tmdbApiKey || '').trim();
}

async function syncRemoteConfig() {
  const now = Date.now();
  if (RUNTIME.lastConfigFetch > 0 && now - RUNTIME.lastConfigFetch < CONFIG.DOMAINS_CACHE_TTL_MS) {
    return;
  }

  const url = (CONFIG.DOMAINS_URL || '').trim();
  if (!url || url.indexOf('YOUR_USERNAME') !== -1 || url.indexOf('YOUR_REPO') !== -1) {
    RUNTIME.lastConfigFetch = now;
    return;
  }

  try {
    // كسر كاش الـ CDN بدقة دقيقة واحدة بحيث تظهر تعديلاتك على GitHub بسرعة
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    const cacheBustUrl = url + sep + 't=' + Math.floor(now / 60000);
    const res = await fetchWithTimeout(
      cacheBustUrl,
      { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } },
      5000
    );

    if (res && res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        const remoteDomain = data['cimanow'];
        if (typeof remoteDomain === 'string' && /^https?:\/\//i.test(remoteDomain.trim())) {
          RUNTIME.baseUrl = remoteDomain.trim().replace(/\/$/, '');
        }
        if (!CONFIG.TMDB_API_KEY && typeof data.tmdb_api_key === 'string' && data.tmdb_api_key.trim()) {
          RUNTIME.tmdbApiKey = data.tmdb_api_key.trim();
        }
        RUNTIME.lastConfigFetch = now;
      }
    }
  } catch (e) {
    console.log('[cimanow] Remote domains.json sync failed, using fallback:', e.message);
  }
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function base64Decode(input) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const str = String(input || '').replace(/[\r\n\s=]+$/g, '');
  let output = '';

  for (let bc = 0, bs = 0, buffer, idx = 0; (buffer = str.charAt(idx++)); ) {
    buffer = chars.indexOf(buffer);
    if (buffer === -1) continue;
    bs = bc % 4 ? bs * 64 + buffer : buffer;
    if (bc++ % 4) {
      output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
    }
  }
  return output;
}

function decodeUtf8Bytes(latin1Str) {
  try {
    let out = '';
    let i = 0;
    const len = latin1Str.length;
    while (i < len) {
      const c = latin1Str.charCodeAt(i++);
      if (c < 128) {
        out += String.fromCharCode(c);
      } else if (c > 191 && c < 224 && i < len) {
        const c2 = latin1Str.charCodeAt(i++);
        out += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
      } else if (c >= 224 && c < 240 && i + 1 < len) {
        const c2 = latin1Str.charCodeAt(i++);
        const c3 = latin1Str.charCodeAt(i++);
        out += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
      } else {
        out += String.fromCharCode(c);
      }
    }
    return out;
  } catch (e) {
    return latin1Str;
  }
}

function safeDecodeURIComponent(str) {
  if (!str) return '';
  try {
    return decodeURIComponent(str);
  } catch (e) {
    return String(str);
  }
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&#038;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, function (_, dec) {
      return String.fromCharCode(parseInt(dec, 10));
    });
}

function buildHeaders(referer, extra) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
    Referer: referer || getBaseUrl() + '/'
  };
  if (extra) {
    Object.keys(extra).forEach(function (k) {
      headers[k] = extra[k];
    });
  }
  return headers;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const limit = timeoutMs || CONFIG.TIMEOUT_MS;
  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, limit);
    try {
      const merged = Object.assign({}, options || {}, { signal: controller.signal });
      return await fetch(url, merged);
    } finally {
      clearTimeout(timer);
    }
  }
  return Promise.race([
    fetch(url, options || {}),
    new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error('Request timeout'));
      }, limit);
    })
  ]);
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(rawUrl, baseUrl) {
  if (!rawUrl) return '';
  const u = decodeHtmlEntities(rawUrl.trim());
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return baseUrl.replace(/\/$/, '') + u;
  return u;
}

function qualityScore(q) {
  const str = String(q || '').toLowerCase();
  if (str.includes('2160') || str.includes('4k')) return 2160;
  if (str.includes('1080') || str.includes('fhd')) return 1080;
  if (str.includes('720') || str.includes('hd')) return 720;
  if (str.includes('480') || str.includes('sd')) return 480;
  if (str.includes('360')) return 360;
  return 500;
}

function normalizeQualityLabel(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('2160') || s.includes('4k') || s.includes('uhd')) return '2160p';
  if (s.includes('1080') || s.includes('fhd')) return '1080p';
  if (s.includes('720')) return '720p';
  if (s.includes('480')) return '480p';
  if (s.includes('360')) return '360p';
  const match = s.match(/(\d{3,4})p?/);
  return match ? match[1] + 'p' : 'Auto';
}

async function resolveMetadata(tmdbId, mediaType) {
  const idStr = String(tmdbId || '').trim();
  const isMovie = mediaType === 'movie';
  const tmdbType = isMovie ? 'movie' : 'tv';
  const stremioType = isMovie ? 'movie' : 'series';

  if (idStr.startsWith('tt')) {
    try {
      const res = await fetchWithTimeout(
        'https://v3-cinemeta.strem.io/meta/' + stremioType + '/' + idStr + '.json',
        { headers: { Accept: 'application/json' } },
        8000
      );
      if (res.ok) {
        const data = await res.json();
        if (data && data.meta && data.meta.name) {
          return {
            title: data.meta.name,
            arabicTitle: '',
            year: data.meta.releaseInfo ? String(data.meta.releaseInfo).slice(0, 4) : ''
          };
        }
      }
    } catch (e) {
      console.log('[CimaNow] Cinemeta error:', e.message);
    }
  }

  const tmdbKey = getTmdbApiKey();
  if (tmdbKey.length > 5) {
    try {
      const apiKey = encodeURIComponent(tmdbKey);
      const enUrl =
        'https://api.themoviedb.org/3/' + tmdbType + '/' + idStr + '?api_key=' + apiKey + '&language=en-US';
      const arUrl =
        'https://api.themoviedb.org/3/' + tmdbType + '/' + idStr + '?api_key=' + apiKey + '&language=ar-SA';

      const [enRes, arRes] = await Promise.all([
        fetchWithTimeout(enUrl, {}, 8000),
        fetchWithTimeout(arUrl, {}, 8000).catch(function () {
          return null;
        })
      ]);

      if (enRes && enRes.ok) {
        const enData = await enRes.json();
        const arData = arRes && arRes.ok ? await arRes.json() : null;
        const title = enData.title || enData.name || enData.original_title || enData.original_name || '';
        const arabicTitle = arData ? arData.title || arData.name || '' : '';
        const dateStr = enData.release_date || enData.first_air_date || '';
        if (title) {
          return {
            title: title,
            arabicTitle: arabicTitle !== title ? arabicTitle : '',
            year: dateStr ? dateStr.slice(0, 4) : ''
          };
        }
      }
    } catch (e) {
      console.log('[CimaNow] TMDB API error:', e.message);
    }
  }

  try {
    const fallbackUrl =
      'https://94c8cb9f702d-tmdb-addon.baby-beamup.club/meta/' +
      stremioType +
      '/tmdb:' +
      encodeURIComponent(idStr) +
      '.json';
    const res = await fetchWithTimeout(fallbackUrl, { headers: { Accept: 'application/json' } }, 9000);
    if (res.ok) {
      const data = await res.json();
      if (data && data.meta && data.meta.name) {
        return {
          title: data.meta.name,
          arabicTitle: '',
          year: data.meta.releaseInfo ? String(data.meta.releaseInfo).slice(0, 4) : ''
        };
      }
    }
  } catch (e) {
    console.log('[CimaNow] Fallback metadata error:', e.message);
  }

  return null;
}

function decodeCimaNowHtml(html) {
  if (!html) return '';
  if (html.indexOf('<article') !== -1 || html.indexOf('id="watch"') !== -1 || html.indexOf('<video') !== -1) {
    return html;
  }

  try {
    const arrayMatch = html.match(/var\s+_0x[a-f0-9]+\s*=\s*(\[[\s\S]*?\]);/i);
    const shiftMatch = html.match(/-\s*(\d{2,6})\s*\)/);
    if (!arrayMatch || !shiftMatch) return html;

    const shift = parseInt(shiftMatch[1], 10);
    const items = [];
    const strRegex = /["']([^"']+)["']/g;
    let m;
    while ((m = strRegex.exec(arrayMatch[1])) !== null) {
      items.push(m[1]);
    }
    if (items.length === 0) return html;

    let raw = '';
    for (let i = 0; i < items.length; i++) {
      const decodedPart = base64Decode(items[i]);
      const digits = decodedPart.replace(/\D/g, '');
      if (digits) {
        const charCode = parseInt(digits, 10) - shift;
        if (charCode > 0 && charCode < 65535) {
          raw += String.fromCharCode(charCode);
        }
      }
    }

    const utf8 = decodeUtf8Bytes(raw);
    return utf8 && utf8.length > 100 ? utf8 : html;
  } catch (e) {
    console.log('[CimaNow] Decode failed, using raw HTML:', e.message);
    return html;
  }
}

function scoreCandidate(candidate, meta, mediaType) {
  const targetTitle = normalizeText(meta.title);
  const targetArabic = normalizeText(meta.arabicTitle);
  const candTitle = normalizeText(candidate.title);
  const urlDecoded = normalizeText(safeDecodeURIComponent(candidate.url || ''));

  let score = 0;

  if (targetTitle && candTitle.includes(targetTitle)) {
    score += 50;
  } else if (targetTitle) {
    const words = targetTitle.split(' ').filter(function (w) {
      return w.length > 2;
    });
    let matched = 0;
    words.forEach(function (w) {
      if (candTitle.includes(w) || urlDecoded.includes(w)) matched++;
    });
    if (words.length > 0) score += Math.round((matched / words.length) * 40);
  }

  if (targetArabic && candTitle.includes(targetArabic)) score += 50;

  if (meta.year && (candidate.title.includes(meta.year) || candidate.url.includes(meta.year))) {
    score += 25;
  }

  const isSeriesUrl =
    urlDecoded.includes('مسلسل') ||
    urlDecoded.includes('الموسم') ||
    urlDecoded.includes('series') ||
    candTitle.includes('مسلسل') ||
    candTitle.includes('الموسم');

  if (mediaType === 'movie' && !isSeriesUrl) score += 15;
  if (mediaType === 'tv' && isSeriesUrl) score += 15;

  return score;
}

async function searchCimaNow(meta, mediaType) {
  const baseUrl = getBaseUrl();
  const queries = [];

  if (mediaType === 'movie' && meta.year) {
    queries.push(meta.title + ' ' + meta.year);
  }
  queries.push(meta.title);
  if (meta.arabicTitle) {
    queries.push(meta.arabicTitle);
  }

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const searchUrl = baseUrl + '/?s=' + encodeURIComponent(q);

    try {
      const res = await fetchWithTimeout(searchUrl, { headers: buildHeaders(baseUrl + '/') });
      if (!res.ok) continue;

      const html = decodeCimaNowHtml(await res.text());
      const candidates = [];
      const articleRegex = /<article\b[\s\S]*?<\/article>/gi;
      let artMatch;

      while ((artMatch = articleRegex.exec(html)) !== null) {
        const block = artMatch[0];
        const hrefMatch = block.match(/<a[^>]+href=["']([^"']+)["']/i);
        if (!hrefMatch) continue;

        const href = normalizeUrl(hrefMatch[1], baseUrl);
        const titleAttrMatch =
          block.match(/<li[^>]*aria-label=["']title["'][^>]*>([\s\S]*?)<\/li>/i) ||
          block.match(/title=["']([^"']+)["']/i) ||
          block.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i);

        const rawTitle = titleAttrMatch
          ? titleAttrMatch[1].replace(/<[^>]+>/g, ' ')
          : block.replace(/<[^>]+>/g, ' ');

        candidates.push({
          url: href,
          title: decodeHtmlEntities(rawTitle).replace(/\s+/g, ' ').trim()
        });
      }

      if (candidates.length > 0) {
        candidates.sort(function (a, b) {
          return scoreCandidate(b, meta, mediaType) - scoreCandidate(a, meta, mediaType);
        });
        return candidates[0].url;
      }
    } catch (e) {
      console.log('[CimaNow] Search query failed (' + q + '):', e.message);
    }
  }

  return null;
}

async function resolveEpisodeUrl(seriesUrl, seasonNum, episodeNum) {
  const baseUrl = getBaseUrl();
  const res = await fetchWithTimeout(seriesUrl, { headers: buildHeaders(baseUrl + '/') });
  if (!res.ok) return null;

  let html = decodeCimaNowHtml(await res.text());
  let currentUrl = seriesUrl;

  if (seasonNum) {
    const seasonRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let sMatch;
    while ((sMatch = seasonRegex.exec(html)) !== null) {
      const href = normalizeUrl(sMatch[1], baseUrl);
      const text = decodeHtmlEntities(sMatch[2].replace(/<[^>]+>/g, ' ')).trim();
      const matchArabicSeason = new RegExp('(?:الموسم|موسم|season|s)\\s*0*' + seasonNum + '(?!\\d)', 'i');

      if (matchArabicSeason.test(text) || matchArabicSeason.test(safeDecodeURIComponent(href))) {
        if (href !== currentUrl) {
          const sRes = await fetchWithTimeout(href, { headers: buildHeaders(currentUrl) });
          if (sRes.ok) {
            html = decodeCimaNowHtml(await sRes.text());
            currentUrl = href;
          }
        }
        break;
      }
    }
  }

  const epRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let eMatch;
  while ((eMatch = epRegex.exec(html)) !== null) {
    const href = normalizeUrl(eMatch[1], baseUrl);
    const inner = eMatch[2];
    const cleanText = decodeHtmlEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

    const emMatch = inner.match(/<em[^>]*>\s*0*(\d+)\s*<\/em>/i);
    if (emMatch && parseInt(emMatch[1], 10) === Number(episodeNum)) {
      return href;
    }

    const epPattern = new RegExp('(?:الحلقه|الحلقة|حلقه|حلقة|episode|ep)\\s*0*' + episodeNum + '(?!\\d)', 'i');
    if (epPattern.test(cleanText) || epPattern.test(safeDecodeURIComponent(href))) {
      return href;
    }
  }

  return null;
}

function collectDirectUrlsFromHtml(html, sourceLabel, watchUrl, seen, streams) {
  const baseUrl = getBaseUrl();

  function addStream(rawUrl, rawQuality, label) {
    const videoUrl = normalizeUrl(rawUrl, baseUrl);
    if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) return;
    if (seen[videoUrl]) return;
    seen[videoUrl] = true;

    const quality = normalizeQualityLabel(rawQuality || videoUrl);
    const streamType = videoUrl.indexOf('.m3u8') !== -1 ? 'HLS' : 'MP4';

    streams.push({
      name: 'CimaNow',
      title: '🎬 CimaNow • ' + quality + ' [' + label + ' - ' + streamType + ']',
      url: videoUrl,
      quality: quality,
      headers: {
        Referer: watchUrl,
        Origin: baseUrl,
        'User-Agent': USER_AGENT
      },
      provider: 'cimanow'
    });
  }

  const sourceRegex = /<source\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = sourceRegex.exec(html)) !== null) {
    const tag = m[0];
    const src = m[1];
    const sizeMatch = tag.match(/size=["']?(\d{3,4})p?["']?/i);
    addStream(src, sizeMatch ? sizeMatch[1] + 'p' : src, sourceLabel || 'Direct');
  }

  const dlLinkRegex = /<a\b[^>]*href=["']([^"']+\.(?:mp4|m3u8)(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = dlLinkRegex.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, ' ');
    const qMatch = text.match(/(2160|1080|720|480|360)p?/i) || href.match(/(2160|1080|720|480|360)p?/i);
    addStream(href, qMatch ? qMatch[1] + 'p' : 'Auto', 'Download Server');
  }

  const rawVideoRegex = /(https?:\/\/[^\s"'<>\\]+?\.(?:mp4|m3u8)(?:\?[^\s"'<>\\]*)?)/gi;
  while ((m = rawVideoRegex.exec(html)) !== null) {
    const clean = m[1].replace(/\\/g, '');
    addStream(clean, clean, sourceLabel || 'Direct');
  }
}

async function fetchAjaxWatchServers(watchHtml, watchUrl, seen, streams) {
  const baseUrl = getBaseUrl();
  const serverRegex = /<li\b[^>]*data-index=["'](\d+)["'][^>]*data-id=["'](\d+)["'][^>]*>([\s\S]*?)<\/li>/gi;
  const tasks = [];
  let match;

  while ((match = serverRegex.exec(watchHtml)) !== null && tasks.length < CONFIG.MAX_AJAX_SERVERS) {
    const index = match[1];
    const id = match[2];
    const serverName = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, ' ')).trim() || 'Server ' + index;

    const ajaxUrl =
      baseUrl +
      '/wp-content/themes/Cima%20Now%20New/core.php?action=switch&index=' +
      encodeURIComponent(index) +
      '&id=' +
      encodeURIComponent(id);

    tasks.push(
      fetchWithTimeout(
        ajaxUrl,
        {
          headers: buildHeaders(watchUrl, {
            'X-Requested-With': 'XMLHttpRequest'
          })
        },
        7000
      )
        .then(function (res) {
          return res.ok ? res.text() : '';
        })
        .then(function (body) {
          if (!body) return;
          const decoded = decodeCimaNowHtml(body);
          collectDirectUrlsFromHtml(decoded, serverName, watchUrl, seen, streams);
        })
        .catch(function () {})
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  try {
    await syncRemoteConfig();

    const type = mediaType === 'movie' ? 'movie' : 'tv';
    const meta = await resolveMetadata(tmdbId, type);

    if (!meta || !meta.title) {
      console.log('[CimaNow] Could not resolve metadata for ID:', tmdbId);
      return [];
    }

    let targetUrl = await searchCimaNow(meta, type);
    if (!targetUrl) {
      console.log('[CimaNow] No search results found for:', meta.title);
      return [];
    }

    if (type === 'tv' && seasonNum && episodeNum) {
      targetUrl = await resolveEpisodeUrl(targetUrl, seasonNum, episodeNum);
      if (!targetUrl) {
        console.log('[CimaNow] Episode not found S' + seasonNum + 'E' + episodeNum);
        return [];
      }
    }

    const watchUrl = targetUrl.endsWith('/watching/')
      ? targetUrl
      : targetUrl.replace(/\/$/, '') + '/watching/';

    const watchRes = await fetchWithTimeout(watchUrl, { headers: buildHeaders(targetUrl) });
    if (!watchRes.ok) {
      console.log('[CimaNow] Watch page status:', watchRes.status);
      return [];
    }

    const watchHtml = decodeCimaNowHtml(await watchRes.text());
    const streams = [];
    const seen = {};

    collectDirectUrlsFromHtml(watchHtml, 'CimaNow Direct', watchUrl, seen, streams);

    if (streams.length < 2) {
      await fetchAjaxWatchServers(watchHtml, watchUrl, seen, streams);
    }

    streams.sort(function (a, b) {
      return qualityScore(b.quality) - qualityScore(a.quality);
    });

    return streams;
  } catch (error) {
    console.log('[CimaNow] Error:', error && error.message ? error.message : error);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
