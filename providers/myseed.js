/**
 * Nuvio Native Plugin - MySeed / ArabSeed Provider (v1.0.0)
 * مخصص لدومين https://m.myseed.tv/ والواجهات الحديثة لعرب سيد
 * متوافق مع بيئة Hermes / React Native بدون أي مكتبات خارجية
 */

const CONFIG = {
  // رابط ملف domains.json في مستودعك لتحديث الدومين مستقبلاً من مكان واحد
  DOMAINS_URL: 'https://raw.githubusercontent.com/minasaad94/nuvio-ar-plugin/main/domains.json',

  // الدومين الافتراضي المباشر (بدون /main/ عشان مسارات البحث تشتغل صح)
  FALLBACK_BASE_URL: 'https://m.myseed.tv',

  // اختياري: مفتاح TMDB المجاني الخاص بك لتحسين البحث للأعمال العربية
  TMDB_API_KEY: '',

  DOMAINS_CACHE_TTL_MS: 30 * 60 * 1000,
  TIMEOUT_MS: 13000,
  MAX_SERVERS_TO_PROBE: 6
};

const RUNTIME = {
  baseUrl: CONFIG.FALLBACK_BASE_URL.replace(/\/$/, ''),
  tmdbApiKey: CONFIG.TMDB_API_KEY,
  lastConfigFetch: 0
};

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

// ============================================================================
// أدوات مساعدة آمنة لبيئة Hermes
// ============================================================================

function getBaseUrl() {
  return (RUNTIME.baseUrl || CONFIG.FALLBACK_BASE_URL)
    .replace(/\/main\/?$/i, '')
    .replace(/\/$/, '');
}

function getTmdbApiKey() {
  return (CONFIG.TMDB_API_KEY || RUNTIME.tmdbApiKey || '').trim();
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
  return String(str)
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

function normalizeUrl(rawUrl, baseUrl) {
  if (!rawUrl) return '';
  const u = decodeHtmlEntities(String(rawUrl).replace(/\\\//g, '/').trim());
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return baseUrl.replace(/\/$/, '') + u;
  return u;
}

function getOriginFromUrl(url) {
  const m = String(url || '').match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : getBaseUrl();
}

function buildHeaders(referer, extra) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ar-EG,ar;q=0.9,en-US;q=0.8,en;q=0.7',
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

function unpackDeanEdwards(source) {
  try {
    const packedMatch = source.match(
      /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/
    );
    if (!packedMatch) return '';

    let p = packedMatch[1];
    const a = parseInt(packedMatch[2], 10);
    let c = parseInt(packedMatch[3], 10);
    const k = packedMatch[4].split('|');

    function encodeBase(num) {
      const prefix = num < a ? '' : encodeBase(parseInt(num / a, 10));
      const rem = num % a;
      return prefix + (rem > 35 ? String.fromCharCode(rem + 29) : rem.toString(36));
    }

    while (c--) {
      if (k[c]) {
        const token = encodeBase(c);
        p = p.replace(new RegExp('\\b' + token + '\\b', 'g'), k[c]);
      }
    }
    return p;
  } catch (e) {
    return '';
  }
}

async function syncRemoteConfig() {
  const now = Date.now();
  if (RUNTIME.lastConfigFetch > 0 && now - RUNTIME.lastConfigFetch < CONFIG.DOMAINS_CACHE_TTL_MS) {
    return;
  }

  const url = (CONFIG.DOMAINS_URL || '').trim();
  if (!url) {
    RUNTIME.lastConfigFetch = now;
    return;
  }

  try {
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    const res = await fetchWithTimeout(
      url + sep + 't=' + Math.floor(now / 60000),
      { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } },
      5000
    );
    if (res && res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        const remoteDomain = data.myseed || data.arabseed;
        if (typeof remoteDomain === 'string' && /^https?:\/\//i.test(remoteDomain.trim())) {
          RUNTIME.baseUrl = remoteDomain.trim().replace(/\/main\/?$/i, '').replace(/\/$/, '');
        }
        if (!CONFIG.TMDB_API_KEY && typeof data.tmdb_api_key === 'string' && data.tmdb_api_key.trim()) {
          RUNTIME.tmdbApiKey = data.tmdb_api_key.trim();
        }
        RUNTIME.lastConfigFetch = now;
      }
    }
  } catch (e) {
    console.log('[MySeed] Remote domains.json sync skipped:', e.message);
  }
}

// ============================================================================
// 1. جلب بيانات الفيلم / المسلسل (الاسم الإنجليزي والعربي + السنة)
// ============================================================================

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
      console.log('[MySeed] Cinemeta error:', e.message);
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
      console.log('[MySeed] TMDB API error:', e.message);
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
    console.log('[MySeed] Fallback metadata error:', e.message);
  }

  return null;
}

// ============================================================================
// 2. البحث داخل m.myseed.tv وترتيب النتائج
// ============================================================================

function scoreCandidate(candidate, meta, mediaType, seasonNum) {
  const targetTitle = normalizeText(meta.title);
  const targetArabic = normalizeText(meta.arabicTitle);
  const candTitle = normalizeText(candidate.title);
  const urlDecoded = normalizeText(safeDecodeURIComponent(candidate.url || ''));

  let score = 0;

  if (targetTitle && (candTitle.includes(targetTitle) || urlDecoded.includes(targetTitle))) {
    score += 55;
  } else if (targetTitle) {
    const words = targetTitle.split(' ').filter(function (w) {
      return w.length > 2;
    });
    let matched = 0;
    words.forEach(function (w) {
      if (candTitle.includes(w) || urlDecoded.includes(w)) matched++;
    });
    if (words.length > 0) score += Math.round((matched / words.length) * 45);
  }

  if (targetArabic && (candTitle.includes(targetArabic) || urlDecoded.includes(targetArabic))) {
    score += 55;
  }

  if (meta.year && (candidate.title.includes(meta.year) || candidate.url.includes(meta.year))) {
    score += 25;
  }

  const isSeries =
    urlDecoded.includes('مسلسل') ||
    urlDecoded.includes('الموسم') ||
    urlDecoded.includes('/selary/') ||
    urlDecoded.includes('/series/') ||
    candTitle.includes('مسلسل') ||
    candTitle.includes('الموسم');

  if (mediaType === 'movie' && !isSeries) score += 20;
  if (mediaType === 'tv' && isSeries) score += 20;

  if (mediaType === 'tv' && seasonNum) {
    const sPattern = new RegExp('(?:الموسم|موسم|season|s)\\s*0*' + seasonNum + '(?!\\d)', 'i');
    if (sPattern.test(candidate.title) || sPattern.test(urlDecoded)) {
      score += 25;
    }
  }

  return score;
}

function parseSearchResults(html, baseUrl) {
  const candidates = [];
  const seen = {};

  function pushCandidate(rawHref, rawTitle) {
    const href = normalizeUrl(rawHref, baseUrl);
    if (!href || seen[href]) return;
    if (!/^https?:\/\//i.test(href)) return;
    if (/\/(category|tag|page|find|main|home|wp-content|wp-admin|actor|genre)\b/i.test(href)) return;
    if (href.replace(/\/$/, '') === baseUrl.replace(/\/$/, '')) return;

    const cleanTitle = decodeHtmlEntities(String(rawTitle || '').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();

    seen[href] = true;
    candidates.push({
      url: href,
      title: cleanTitle || safeDecodeURIComponent(href)
    });
  }

  const newAnchorRegex = /<a\b[^>]*class=["'][^"']*(?:movie__block|MovieBlock|block__item)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = newAnchorRegex.exec(html)) !== null) {
    const tag = m[0];
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const titleMatch =
      tag.match(/title=["']([^"']+)["']/i) ||
      m[1].match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i);
    pushCandidate(hrefMatch[1], titleMatch ? titleMatch[1] : m[1]);
  }

  const blockRegex = /<(?:div|li|article)\b[^>]*class=["'][^"']*(?:MovieBlock|movie__block|BlockItem|post)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|li|article)>/gi;
  while ((m = blockRegex.exec(html)) !== null) {
    const block = m[0];
    const hrefMatch = block.match(/<a\b[^>]*href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const titleMatch =
      block.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i) ||
      block.match(/title=["']([^"']+)["']/i);
    pushCandidate(hrefMatch[1], titleMatch ? titleMatch[1] : '');
  }

  if (candidates.length === 0) {
    const genericRegex = /<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*title=["']([^"']{3,})["'][^>]*>/gi;
    while ((m = genericRegex.exec(html)) !== null) {
      if (m[1].indexOf(getOriginFromUrl(baseUrl)) !== -1) {
        pushCandidate(m[1], m[2]);
      }
    }
  }

  return candidates;
}

async function searchMySeed(meta, mediaType, seasonNum) {
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
    const encoded = encodeURIComponent(q);

    const searchUrls = [
      baseUrl + '/find/?find=' + encoded,
      baseUrl + '/find/?word=' + encoded,
      baseUrl + '/?s=' + encoded
    ];

    for (let j = 0; j < searchUrls.length; j++) {
      try {
        const res = await fetchWithTimeout(searchUrls[j], { headers: buildHeaders(baseUrl + '/main/') });
        if (!res.ok) continue;

        const html = await res.text();
        const candidates = parseSearchResults(html, baseUrl);
        if (candidates.length > 0) {
          candidates.sort(function (a, b) {
            return scoreCandidate(b, meta, mediaType, seasonNum) - scoreCandidate(a, meta, mediaType, seasonNum);
          });
          return candidates[0].url;
        }
      } catch (e) {
        console.log('[MySeed] Search request failed:', e.message);
      }
    }
  }

  return null;
}

// ============================================================================
// 3. الوصول إلى الموسم والحلقة في حالة المسلسلات
// ============================================================================

async function resolveEpisodeUrl(seriesUrl, seasonNum, episodeNum) {
  const baseUrl = getBaseUrl();
  const res = await fetchWithTimeout(seriesUrl, { headers: buildHeaders(baseUrl + '/main/') });
  if (!res.ok) return null;

  let html = await res.text();
  let currentUrl = seriesUrl;

  if (seasonNum) {
    const seasonRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let sm;
    while ((sm = seasonRegex.exec(html)) !== null) {
      const href = normalizeUrl(sm[1], baseUrl);
      const text = decodeHtmlEntities(sm[2].replace(/<[^>]+>/g, ' ')).trim();
      const sPattern = new RegExp('(?:الموسم|موسم|season|s)\\s*0*' + seasonNum + '(?!\\d)', 'i');
      if ((sPattern.test(text) || sPattern.test(safeDecodeURIComponent(href))) && href !== currentUrl) {
        if (href.indexOf('#') === -1 && href.indexOf(getOriginFromUrl(baseUrl)) !== -1) {
          const sRes = await fetchWithTimeout(href, { headers: buildHeaders(currentUrl) });
          if (sRes.ok) {
            html = await sRes.text();
            currentUrl = href;
          }
          break;
        }
      }
    }
  }

  const epRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let em;
  while ((em = epRegex.exec(html)) !== null) {
    const href = normalizeUrl(em[1], baseUrl);
    if (href.indexOf('#') !== -1) continue;

    const inner = em[2];
    const cleanText = decodeHtmlEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const decodedHref = safeDecodeURIComponent(href);

    const emTag = inner.match(/<(?:em|span|b)[^>]*>\s*0*(\d+)\s*<\/(?:em|span|b)>/i);
    if (emTag && parseInt(emTag[1], 10) === Number(episodeNum) && /حلقة|حلقه|ep|episode/i.test(cleanText + decodedHref)) {
      return href;
    }

    const epPattern = new RegExp('(?:الحلقة|الحلقه|حلقة|حلقه|episode|ep)\\s*0*' + episodeNum + '(?!\\d)', 'i');
    if (epPattern.test(cleanText) || epPattern.test(decodedHref)) {
      return href;
    }
  }

  return null;
}

// ============================================================================
// 4. استخراج روابط البث المباشر وفحص سيرفرات التبديل والـ Iframes
// ============================================================================

function extractMediaFromText(text, sourceLabel, refererUrl, defaultQuality, seen, streams) {
  function pushStream(rawUrl, qHint) {
    const cleanUrl = decodeHtmlEntities(String(rawUrl || '').replace(/\\\//g, '/').trim());
    if (!/^https?:\/\//i.test(cleanUrl)) return;
    if (seen[cleanUrl]) return;
    if (/\.(?:jpg|jpeg|png|webp|gif|svg|vtt|srt|js|css|ico)(?:\?|$)/i.test(cleanUrl)) return;
    seen[cleanUrl] = true;

    const quality = normalizeQualityLabel(qHint || defaultQuality || cleanUrl);
    const streamType = cleanUrl.indexOf('.m3u8') !== -1 ? 'HLS' : 'MP4';

    streams.push({
      name: 'MySeed',
      title: '🎬 MySeed • ' + quality + ' [' + sourceLabel + ' - ' + streamType + ']',
      url: cleanUrl,
      quality: quality,
      headers: {
        Referer: refererUrl,
        Origin: getOriginFromUrl(refererUrl),
        'User-Agent': USER_AGENT
      },
      provider: 'myseed'
    });
  }

  const unpacked = unpackDeanEdwards(text);
  const combined = unpacked ? text + '\n' + unpacked : text;

  const sourceRegex = /<source\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = sourceRegex.exec(combined)) !== null) {
    const sizeMatch = m[0].match(/(?:size|label)=["']?(\d{3,4}p?)["']?/i);
    pushStream(m[1], sizeMatch ? sizeMatch[1] : defaultQuality);
  }

  const jwRegex = /file\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["'](?:[^}]{0,100}label\s*:\s*["']([^"']+)["'])?/gi;
  while ((m = jwRegex.exec(combined)) !== null) {
    pushStream(m[1], m[2] || defaultQuality);
  }

  const rawRegex = /(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?)/gi;
  while ((m = rawRegex.exec(combined)) !== null) {
    pushStream(m[1], defaultQuality);
  }
}

async function probeEmbedUrl(embedUrl, label, qualityHint, watchUrl, seen, streams) {
  try {
    const res = await fetchWithTimeout(embedUrl, { headers: buildHeaders(watchUrl) }, 9000);
    if (!res.ok) return;
    const html = await res.text();
    extractMediaFromText(html, label, embedUrl, qualityHint, seen, streams);

    const nestedIframe = html.match(/<iframe\b[^>]*src=["'](https?:\/\/[^"']+)["']/i);
    if (nestedIframe && nestedIframe[1] && nestedIframe[1] !== embedUrl) {
      if (!/google|facebook|ads|disqus|cloudflare/i.test(nestedIframe[1])) {
        const res2 = await fetchWithTimeout(nestedIframe[1], { headers: buildHeaders(embedUrl) }, 8000);
        if (res2.ok) {
          extractMediaFromText(await res2.text(), label, nestedIframe[1], qualityHint, seen, streams);
        }
      }
    }
  } catch (e) {
    console.log('[MySeed] Embed probe skipped (' + label + '):', e.message);
  }
}

async function probeAjaxServers(watchHtml, watchUrl, baseUrl, seen, streams) {
  const csrfMatch =
    watchHtml.match(/csrf__token["']?\s*[:=]\s*["']([^"']+)["']/i) ||
    watchHtml.match(/name=["']csrf_token["'][^>]*value=["']([^"']+)["']/i);
  const postIdMatch =
    watchHtml.match(/data-post=["'](\d+)["']/i) ||
    watchHtml.match(/post_id["']?\s*[:=]\s*["']?(\d+)["']?/i);

  if (!postIdMatch) return;

  const postId = postIdMatch[1];
  const csrfToken = csrfMatch ? csrfMatch[1] : '';
  const serverRegex = /<li\b[^>]*data-server=["'](\d+)["'][^>]*>([\s\S]*?)<\/li>/gi;
  const ajaxTasks = [];
  let sm;

  while ((sm = serverRegex.exec(watchHtml)) !== null && ajaxTasks.length < 4) {
    const serverIdx = sm[1];
    const quMatch = sm[0].match(/data-qu=["'](\d+)["']/i);
    const quality = quMatch ? quMatch[1] + 'p' : '1080p';
    const label = decodeHtmlEntities(sm[2].replace(/<[^>]+>/g, ' ')).trim() || 'Server ' + serverIdx;

    const formBody =
      'post_id=' +
      encodeURIComponent(postId) +
      '&quality=' +
      encodeURIComponent(quMatch ? quMatch[1] : '1080') +
      '&server=' +
      encodeURIComponent(serverIdx) +
      (csrfToken ? '&csrf_token=' + encodeURIComponent(csrfToken) : '');

    ajaxTasks.push(
      fetchWithTimeout(
        baseUrl + '/get__watch__server/',
        {
          method: 'POST',
          headers: buildHeaders(watchUrl, {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            Origin: baseUrl
          }),
          body: formBody
        },
        8000
      )
        .then(function (r) {
          return r.ok ? r.text() : '';
        })
        .then(function (txt) {
          if (!txt) return;
          let embedUrl = '';
          try {
            const parsed = JSON.parse(txt);
            embedUrl = parsed.server || parsed.url || '';
          } catch (e) {
            const m = txt.match(/https?:\/\/[^\s"'<>\\]+/i);
            embedUrl = m ? m[0] : '';
          }
          if (embedUrl) {
            return probeEmbedUrl(normalizeUrl(embedUrl, baseUrl), label, quality, watchUrl, seen, streams);
          }
        })
        .catch(function () {})
    );
  }

  if (ajaxTasks.length > 0) {
    await Promise.all(ajaxTasks);
  }
}

async function resolveWatchUrl(itemUrl, baseUrl) {
  try {
    const res = await fetchWithTimeout(itemUrl, { headers: buildHeaders(baseUrl + '/main/') });
    if (res.ok) {
      const html = await res.text();
      const watchBtnMatch =
        html.match(/<a\b[^>]*class=["'][^"']*(?:watchBTn|watch__btn)[^"']*["'][^>]*href=["']([^"']+)["']/i) ||
        html.match(/<a\b[^>]*href=["']([^"']+\/watch\/?)["']/i);
      if (watchBtnMatch && watchBtnMatch[1]) {
        return normalizeUrl(watchBtnMatch[1], baseUrl);
      }
    }
  } catch (e) {
    console.log('[MySeed] Item page fetch failed:', e.message);
  }
  return itemUrl.replace(/\/$/, '') + '/watch/';
}

// ============================================================================
// 5. الدالة الرئيسية (تدعم الصيغة الموضعية وصيغة الـ Object معاً)
// ============================================================================

async function getStreams(tmdbIdOrObj, mediaType, seasonNum, episodeNum) {
  try {
    let tmdbId = tmdbIdOrObj;
    let typeArg = mediaType;
    let seasonArg = seasonNum;
    let episodeArg = episodeNum;

    if (tmdbIdOrObj && typeof tmdbIdOrObj === 'object') {
      tmdbId = tmdbIdOrObj.tmdbId || tmdbIdOrObj.id || tmdbIdOrObj.imdbId;
      typeArg = tmdbIdOrObj.mediaType || tmdbIdOrObj.type;
      seasonArg = tmdbIdOrObj.season || tmdbIdOrObj.seasonNum;
      episodeArg = tmdbIdOrObj.episode || tmdbIdOrObj.episodeNum;
    }

    await syncRemoteConfig();

    const baseUrl = getBaseUrl();
    const type = typeArg === 'movie' ? 'movie' : 'tv';

    const meta = await resolveMetadata(tmdbId, type);
    if (!meta || !meta.title) {
      console.log('[MySeed] Metadata not resolved for:', tmdbId);
      return [];
    }

    let targetUrl = await searchMySeed(meta, type, seasonArg);
    if (!targetUrl) {
      console.log('[MySeed] No search results for:', meta.title);
      return [];
    }

    if (type === 'tv' && episodeArg) {
      targetUrl = await resolveEpisodeUrl(targetUrl, seasonArg, episodeArg);
      if (!targetUrl) {
        console.log('[MySeed] Episode not found S' + seasonArg + 'E' + episodeArg);
        return [];
      }
    }

    const watchUrl = await resolveWatchUrl(targetUrl, baseUrl);
    const watchRes = await fetchWithTimeout(watchUrl, { headers: buildHeaders(targetUrl) });
    if (!watchRes.ok) {
      console.log('[MySeed] Watch page HTTP status:', watchRes.status);
      return [];
    }

    const watchHtml = await watchRes.text();
    const streams = [];
    const seen = {};

    extractMediaFromText(watchHtml, 'MySeed Direct', watchUrl, 'Auto', seen, streams);

    const embeds = [];
    const seenEmbeds = {};

    const attrRegex = /<(?:li|button|a)\b[^>]*data-(?:link|embed|url)=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:li|button|a)>/gi;
    let m;
    while ((m = attrRegex.exec(watchHtml)) !== null) {
      const embedUrl = normalizeUrl(m[1], baseUrl);
      if (!/^https?:\/\//i.test(embedUrl) || seenEmbeds[embedUrl]) continue;
      seenEmbeds[embedUrl] = true;
      const text = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      const qMatch = text.match(/(2160|1080|720|480|360)p?/i);
      embeds.push({
        url: embedUrl,
        label: text || 'Server',
        quality: qMatch ? qMatch[1] + 'p' : 'Auto'
      });
    }

    const iframeRegex = /<iframe\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
    while ((m = iframeRegex.exec(watchHtml)) !== null) {
      const embedUrl = normalizeUrl(m[1], baseUrl);
      if (!/^https?:\/\//i.test(embedUrl) || seenEmbeds[embedUrl]) continue;
      if (/google|facebook|twitter|ads|disqus|cloudflare/i.test(embedUrl)) continue;
      seenEmbeds[embedUrl] = true;
      embeds.push({
        url: embedUrl,
        label: 'MySeed Player',
        quality: 'Auto'
      });
    }

    embeds.sort(function (a, b) {
      const aPref = /myseed|arabseed|asd\.|reviewrate|gamezone/i.test(a.url + a.label) ? 1 : 0;
      const bPref = /myseed|arabseed|asd\.|reviewrate|gamezone/i.test(b.url + b.label) ? 1 : 0;
      return bPref - aPref;
    });

    const probeTasks = embeds.slice(0, CONFIG.MAX_SERVERS_TO_PROBE).map(function (emb) {
      return probeEmbedUrl(emb.url, emb.label, emb.quality, watchUrl, seen, streams);
    });

    await Promise.all([
      Promise.all(probeTasks),
      probeAjaxServers(watchHtml, watchUrl, baseUrl, seen, streams)
    ]);

    streams.sort(function (a, b) {
      return qualityScore(b.quality) - qualityScore(a.quality);
    });

    return streams;
  } catch (error) {
    console.log('[MySeed] Fatal error:', error && error.message ? error.message : error);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
