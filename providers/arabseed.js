/**
 * Nuvio Native Plugin - ArabSeed Provider (v1.1.0)
 * يقرأ الدومين تلقائياً من ملف domains.json المركزي في جذر المستودع
 * يعمل محلياً داخل Nuvio (متوافق مع Hermes بدون أي مكتبات خارجية)
 */

const CONFIG = {
  // ضع رابط ملف domains.json المباشر (Raw) من مستودعك على GitHub مرة واحدة فقط
  // مثال: 'https://raw.githubusercontent.com/USERNAME/nuvio-arabic-streams/main/domains.json'
  DOMAINS_URL: 'https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/domains.json',

  // الدومين الاحتياطي في حال تعذر الوصول إلى domains.json أو قبل تعديل الرابط بالأعلى
  FALLBACK_BASE_URL: 'https://a.asd.homes',

  // اختياري: مفتاح TMDB محلي (لو تركته فارغاً سيقرأ من tmdb_api_key داخل domains.json إن وجد)
  TMDB_API_KEY: '',

  // مدة الكاش للدومينات (30 دقيقة) لتسريع التشغيل وعدم تكرار الطلب مع كل فيلم
  DOMAINS_CACHE_TTL_MS: 30 * 60 * 1000,
  TIMEOUT_MS: 12000,
  MAX_IFRAME_PROBES: 5
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
        const remoteDomain = data['arabseed'];
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
    console.log('[arabseed] Remote domains.json sync failed, using fallback:', e.message);
  }
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

function getOriginFromUrl(url) {
  const m = String(url || '').match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : getBaseUrl();
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
      console.log('[ArabSeed] Cinemeta error:', e.message);
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
      console.log('[ArabSeed] TMDB API error:', e.message);
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
    console.log('[ArabSeed] Fallback metadata error:', e.message);
  }

  return null;
}

function scoreCandidate(candidate, meta, mediaType, seasonNum) {
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

  const isSeries =
    urlDecoded.includes('مسلسل') ||
    urlDecoded.includes('الموسم') ||
    urlDecoded.includes('/selary/') ||
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

function parseSearchBlocks(html, baseUrl) {
  const candidates = [];
  const seen = {};

  const blockRegex = /<(?:div|li|article)\b[^>]*class=["'][^"']*(?:MovieBlock|BlockItem|post)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|li|article)>/gi;
  let match;
  while ((match = blockRegex.exec(html)) !== null) {
    const block = match[0];
    const hrefMatch = block.match(/<a\b[^>]*href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const href = normalizeUrl(hrefMatch[1], baseUrl);
    if (seen[href] || href.indexOf('/category/') !== -1) continue;

    const titleMatch =
      block.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i) ||
      block.match(/title=["']([^"']+)["']/i) ||
      block.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
    const title = titleMatch
      ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
      : safeDecodeURIComponent(href);

    seen[href] = true;
    candidates.push({ url: href, title: title });
  }

  if (candidates.length === 0) {
    const linkRegex = /<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*title=["']([^"']{3,})["'][^>]*>/gi;
    while ((match = linkRegex.exec(html)) !== null) {
      const href = normalizeUrl(match[1], baseUrl);
      if (seen[href] || href.indexOf(baseUrl) === -1) continue;
      if (/\/(category|tag|page|find|main|home)\b/i.test(href)) continue;
      seen[href] = true;
      candidates.push({ url: href, title: decodeHtmlEntities(match[2]).trim() });
    }
  }

  return candidates;
}

async function searchArabSeed(meta, mediaType, seasonNum) {
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
    const searchUrls = [
      baseUrl + '/find/?word=' + encodeURIComponent(q),
      baseUrl + '/?s=' + encodeURIComponent(q)
    ];

    for (let j = 0; j < searchUrls.length; j++) {
      try {
        const res = await fetchWithTimeout(searchUrls[j], { headers: buildHeaders(baseUrl + '/') });
        if (!res.ok) continue;

        const html = await res.text();
        const candidates = parseSearchBlocks(html, baseUrl);
        if (candidates.length > 0) {
          candidates.sort(function (a, b) {
            return scoreCandidate(b, meta, mediaType, seasonNum) - scoreCandidate(a, meta, mediaType, seasonNum);
          });
          return candidates[0].url;
        }
      } catch (e) {
        console.log('[ArabSeed] Search error (' + q + '):', e.message);
      }
    }
  }

  return null;
}

async function resolveEpisodeUrl(seriesUrl, seasonNum, episodeNum) {
  const baseUrl = getBaseUrl();
  const res = await fetchWithTimeout(seriesUrl, { headers: buildHeaders(baseUrl + '/') });
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
        if (href.indexOf(baseUrl) !== -1 && href.indexOf('#') === -1) {
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
    const inner = em[2];
    const cleanText = decodeHtmlEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const decodedHref = safeDecodeURIComponent(href);

    const emTag = inner.match(/<em[^>]*>\s*0*(\d+)\s*<\/em>/i);
    if (emTag && parseInt(emTag[1], 10) === Number(episodeNum) && href.indexOf('#') === -1) {
      return href;
    }

    const epPattern = new RegExp('(?:الحلقة|الحلقه|حلقة|حلقه|episode|ep)\\s*0*' + episodeNum + '(?!\\d)', 'i');
    if (epPattern.test(cleanText) || epPattern.test(decodedHref)) {
      if (href.indexOf('#') === -1) return href;
    }
  }

  return null;
}

function extractMediaFromText(text, sourceLabel, refererUrl, defaultQuality, seen, streams) {
  function pushStream(rawUrl, qHint) {
    const cleanUrl = decodeHtmlEntities(String(rawUrl || '').replace(/\\\//g, '/').trim());
    if (!/^https?:\/\//i.test(cleanUrl)) return;
    if (seen[cleanUrl]) return;
    if (/\.(?:jpg|jpeg|png|webp|gif|vtt|srt|js|css)(?:\?|$)/i.test(cleanUrl)) return;
    seen[cleanUrl] = true;

    const quality = normalizeQualityLabel(qHint || defaultQuality || cleanUrl);
    const streamType = cleanUrl.indexOf('.m3u8') !== -1 ? 'HLS' : 'MP4';

    streams.push({
      name: 'ArabSeed',
      title: '🎬 ArabSeed • ' + quality + ' [' + sourceLabel + ' - ' + streamType + ']',
      url: cleanUrl,
      quality: quality,
      headers: {
        Referer: refererUrl,
        Origin: getOriginFromUrl(refererUrl),
        'User-Agent': USER_AGENT
      },
      provider: 'arabseed'
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

  const jwRegex = /file\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["'](?:[^}]{0,80}label\s*:\s*["']([^"']+)["'])?/gi;
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
    const res = await fetchWithTimeout(embedUrl, { headers: buildHeaders(watchUrl) }, 8000);
    if (!res.ok) return;
    const html = await res.text();
    extractMediaFromText(html, label, embedUrl, qualityHint, seen, streams);
  } catch (e) {
    console.log('[ArabSeed] Embed probe skipped (' + label + '):', e.message);
  }
}

async function resolveWatchPage(itemUrl, baseUrl) {
  try {
    const res = await fetchWithTimeout(itemUrl, { headers: buildHeaders(baseUrl + '/') });
    if (res.ok) {
      const html = await res.text();
      const watchBtnMatch =
        html.match(/<a\b[^>]*class=["'][^"']*watchBTn[^"']*["'][^>]*href=["']([^"']+)["']/i) ||
        html.match(/<a\b[^>]*href=["']([^"']+\/watch\/?)["']/i);
      if (watchBtnMatch && watchBtnMatch[1]) {
        return { watchUrl: normalizeUrl(watchBtnMatch[1], baseUrl), itemHtml: html };
      }
      return { watchUrl: itemUrl.replace(/\/$/, '') + '/watch/', itemHtml: html };
    }
  } catch (e) {
    console.log('[ArabSeed] Item page error:', e.message);
  }
  return { watchUrl: itemUrl.replace(/\/$/, '') + '/watch/', itemHtml: '' };
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  try {
    await syncRemoteConfig();

    const baseUrl = getBaseUrl();
    const type = mediaType === 'movie' ? 'movie' : 'tv';

    const meta = await resolveMetadata(tmdbId, type);
    if (!meta || !meta.title) {
      console.log('[ArabSeed] Could not resolve metadata for ID:', tmdbId);
      return [];
    }

    let targetUrl = await searchArabSeed(meta, type, seasonNum);
    if (!targetUrl) {
      console.log('[ArabSeed] No search results found for:', meta.title);
      return [];
    }

    if (type === 'tv' && episodeNum) {
      targetUrl = await resolveEpisodeUrl(targetUrl, seasonNum, episodeNum);
      if (!targetUrl) {
        console.log('[ArabSeed] Episode not found S' + seasonNum + 'E' + episodeNum);
        return [];
      }
    }

    const resolved = await resolveWatchPage(targetUrl, baseUrl);
    const watchUrl = resolved.watchUrl;

    const watchRes = await fetchWithTimeout(watchUrl, { headers: buildHeaders(targetUrl) });
    if (!watchRes.ok) {
      console.log('[ArabSeed] Watch page status:', watchRes.status);
      return [];
    }

    const watchHtml = await watchRes.text();
    const streams = [];
    const seen = {};

    extractMediaFromText(watchHtml, 'ArabSeed Direct', watchUrl, 'Auto', seen, streams);

    const embeds = [];
    const seenEmbeds = {};

    const dataLinkRegex = /<li\b[^>]*data-link=["']([^"']+)["'][^>]*>([\s\S]*?)<\/li>/gi;
    let dm;
    while ((dm = dataLinkRegex.exec(watchHtml)) !== null) {
      const embedUrl = normalizeUrl(dm[1], baseUrl);
      if (!/^https?:\/\//i.test(embedUrl) || seenEmbeds[embedUrl]) continue;
      seenEmbeds[embedUrl] = true;
      const text = decodeHtmlEntities(dm[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      const qMatch = text.match(/(2160|1080|720|480|360)p?/i);
      embeds.push({
        url: embedUrl,
        label: text || 'Server',
        quality: qMatch ? qMatch[1] + 'p' : 'Auto'
      });
    }

    const iframeRegex = /<iframe\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
    let im;
    while ((im = iframeRegex.exec(watchHtml)) !== null) {
      const embedUrl = normalizeUrl(im[1], baseUrl);
      if (!/^https?:\/\//i.test(embedUrl) || seenEmbeds[embedUrl]) continue;
      if (/google|facebook|twitter|ads|disqus/i.test(embedUrl)) continue;
      seenEmbeds[embedUrl] = true;
      embeds.push({
        url: embedUrl,
        label: 'ArabSeed Server',
        quality: 'Auto'
      });
    }

    embeds.sort(function (a, b) {
      const aPref = /arabseed|asd\.|reviewrate|gamezone/i.test(a.url + a.label) ? 1 : 0;
      const bPref = /arabseed|asd\.|reviewrate|gamezone/i.test(b.url + b.label) ? 1 : 0;
      return bPref - aPref;
    });

    const toProbe = embeds.slice(0, CONFIG.MAX_IFRAME_PROBES);
    if (toProbe.length > 0) {
      await Promise.all(
        toProbe.map(function (emb) {
          return probeEmbedUrl(emb.url, emb.label, emb.quality, watchUrl, seen, streams);
        })
      );
    }

    streams.sort(function (a, b) {
      return qualityScore(b.quality) - qualityScore(a.quality);
    });

    return streams;
  } catch (error) {
    console.log('[ArabSeed] Error:', error && error.message ? error.message : error);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
