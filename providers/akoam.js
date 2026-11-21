/**
 * Nuvio Native Plugin - Akoam Provider (v1.1.0)
 * يقرأ الدومين تلقائياً من ملف domains.json المركزي في جذر المستودع
 * يعمل محلياً داخل Nuvio (متوافق مع Hermes بدون أي مكتبات خارجية)
 */

const CONFIG = {
  // ضع رابط ملف domains.json المباشر (Raw) من مستودعك على GitHub مرة واحدة فقط
  // مثال: 'https://raw.githubusercontent.com/USERNAME/nuvio-arabic-streams/main/domains.json'
  DOMAINS_URL: 'https://raw.githubusercontent.com/minasaad94/nuvio-ar-plugin/main/domains.json',

  // الدومين الاحتياطي في حال تعذر الوصول إلى domains.json أو قبل تعديل الرابط بالأعلى
  FALLBACK_BASE_URL: 'https://ak.sv',

  // اختياري: مفتاح TMDB محلي (لو تركته فارغاً سيقرأ من tmdb_api_key داخل domains.json إن وجد)
  TMDB_API_KEY: '',

  // مدة الكاش للدومينات (30 دقيقة) لتسريع التشغيل وعدم تكرار الطلب مع كل فيلم
  DOMAINS_CACHE_TTL_MS: 30 * 60 * 1000,
  TIMEOUT_MS: 12000,
  MAX_QUALITY_LINKS: 4
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
        const remoteDomain = data['akoam'];
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
    console.log('[akoam] Remote domains.json sync failed, using fallback:', e.message);
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
      console.log('[Akoam] Cinemeta error:', e.message);
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
      console.log('[Akoam] TMDB API error:', e.message);
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
    console.log('[Akoam] Fallback metadata error:', e.message);
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

  const isMovieUrl = candidate.url.indexOf('/movie/') !== -1;
  const isSeriesUrl = candidate.url.indexOf('/series/') !== -1 || candidate.url.indexOf('/shows/') !== -1;

  if (mediaType === 'movie' && isMovieUrl) score += 25;
  if (mediaType === 'tv' && isSeriesUrl) score += 25;
  if (mediaType === 'movie' && isSeriesUrl) score -= 20;
  if (mediaType === 'tv' && isMovieUrl) score -= 20;

  if (mediaType === 'tv' && seasonNum) {
    const sPattern = new RegExp('(?:الموسم|موسم|season|s)\\s*0*' + seasonNum + '(?!\\d)', 'i');
    const arabicOrdinals = ['', 'الاول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
    const ord = arabicOrdinals[Number(seasonNum)] || '';
    if (sPattern.test(candidate.title) || sPattern.test(urlDecoded)) {
      score += 30;
    } else if (ord && (candTitle.includes('الموسم ' + ord) || urlDecoded.includes(ord))) {
      score += 30;
    }
  }

  return score;
}

async function searchAkoam(meta, mediaType, seasonNum) {
  const baseUrl = getBaseUrl();
  const section = mediaType === 'movie' ? 'movie' : 'series';
  const queries = [];

  if (mediaType === 'tv' && seasonNum && Number(seasonNum) > 1) {
    queries.push(meta.title + ' الموسم ' + seasonNum);
  }
  queries.push(meta.title);
  if (meta.arabicTitle) {
    queries.push(meta.arabicTitle);
  }

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const searchUrl = baseUrl + '/search?q=' + encodeURIComponent(q) + '&section=' + section;

    try {
      const res = await fetchWithTimeout(searchUrl, { headers: buildHeaders(baseUrl + '/') });
      if (!res.ok) continue;

      const html = await res.text();
      const candidates = [];
      const seen = {};

      const linkRegex = /<a\b[^>]*href=["'](https?:\/\/[^"']+\/(?:movie|series|shows)\/\d+\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let match;

      while ((match = linkRegex.exec(html)) !== null) {
        const href = normalizeUrl(match[1], baseUrl);
        if (seen[href]) continue;

        const text = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
        const titleFromSlug = safeDecodeURIComponent(href.split('/').pop() || '').replace(/[-_]+/g, ' ');
        const finalTitle = text.length > 2 ? text : titleFromSlug;

        seen[href] = true;
        candidates.push({
          url: href,
          title: finalTitle
        });
      }

      if (candidates.length > 0) {
        candidates.sort(function (a, b) {
          return scoreCandidate(b, meta, mediaType, seasonNum) - scoreCandidate(a, meta, mediaType, seasonNum);
        });
        return candidates[0].url;
      }
    } catch (e) {
      console.log('[Akoam] Search failed (' + q + '):', e.message);
    }
  }

  return null;
}

async function resolveEpisodeUrl(seriesUrl, episodeNum) {
  const baseUrl = getBaseUrl();
  const res = await fetchWithTimeout(seriesUrl, { headers: buildHeaders(baseUrl + '/') });
  if (!res.ok) return null;

  const html = await res.text();
  const epRegex = /<a\b[^>]*href=["']([^"']+\/episode\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = epRegex.exec(html)) !== null) {
    const href = normalizeUrl(match[1], baseUrl);
    const text = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const decodedHref = safeDecodeURIComponent(href);

    const exactPattern = new RegExp('(?:الحلقة|الحلقه|حلقة|حلقه|episode|ep)\\s*0*' + episodeNum + '(?!\\d)', 'i');
    if (exactPattern.test(text) || exactPattern.test(decodedHref)) {
      return href;
    }

    const numMatch = text.match(/^\s*0*(\d+)\b/);
    if (numMatch && parseInt(numMatch[1], 10) === Number(episodeNum)) {
      return href;
    }
  }

  return null;
}

function extractAkoamActionLinks(pageHtml, baseUrl) {
  const links = [];
  const seen = {};

  const tabQualityMap = {};
  const tabHeaderRegex = /<a\b[^>]*href=["']#(tab-\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let tm;
  while ((tm = tabHeaderRegex.exec(pageHtml)) !== null) {
    const tabId = tm[1];
    const tabText = decodeHtmlEntities(tm[2].replace(/<[^>]+>/g, ' ')).trim();
    tabQualityMap[tabId] = normalizeQualityLabel(tabText);
  }

  const tabBlocks = pageHtml.split(/(?=<div[^>]+id=["']tab-\d+["'])/i);
  for (let i = 0; i < tabBlocks.length; i++) {
    const block = tabBlocks[i];
    const idMatch = block.match(/id=["'](tab-\d+)["']/i);
    const tabQuality = idMatch && tabQualityMap[idMatch[1]] ? tabQualityMap[idMatch[1]] : '';

    const actionRegex = /<a\b[^>]*href=["'](https?:\/\/[^"']+(?:\/link\/|\/watch\/|\/download\/)[^"']+)["'][^>]*class=["'][^"']*(?:link-show|link-download|link-btn)[^"']*["'][^>]*>/gi;
    let am;
    while ((am = actionRegex.exec(block)) !== null) {
      const url = normalizeUrl(am[1], baseUrl);
      if (seen[url]) continue;
      seen[url] = true;
      const isWatch = am[0].indexOf('link-show') !== -1 || url.indexOf('/watch/') !== -1;
      links.push({
        url: url,
        quality: tabQuality || 'Auto',
        isWatch: isWatch
      });
    }
  }

  if (links.length === 0) {
    const genericRegex = /<a\b[^>]*href=["'](https?:\/\/[^"']+\/(?:link|watch)\/\d+[^"']*)["'][^>]*>/gi;
    let gm;
    while ((gm = genericRegex.exec(pageHtml)) !== null) {
      const url = normalizeUrl(gm[1], baseUrl);
      if (seen[url]) continue;
      seen[url] = true;
      links.push({
        url: url,
        quality: 'Auto',
        isWatch: url.indexOf('/watch/') !== -1
      });
    }
  }

  links.sort(function (a, b) {
    if (a.isWatch !== b.isWatch) return a.isWatch ? -1 : 1;
    return qualityScore(b.quality) - qualityScore(a.quality);
  });

  return links.slice(0, CONFIG.MAX_QUALITY_LINKS);
}

async function resolveAkoamFinalStream(entry, pageUrl, baseUrl) {
  const found = [];

  try {
    let currentUrl = entry.url;
    let res = await fetchWithTimeout(currentUrl, { headers: buildHeaders(pageUrl) }, 10000);
    if (!res.ok) return found;
    let html = await res.text();

    const nextLinkMatch =
      html.match(/<a\b[^>]*class=["'][^"']*download-link[^"']*["'][^>]*href=["']([^"']+)["']/i) ||
      html.match(/<a\b[^>]*href=["'](https?:\/\/[^"']+\/(?:watch|download)\/\d+\/\d+[^"']*)["']/i) ||
      html.match(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*class=["'][^"']*download-link[^"']*["']/i);

    if (nextLinkMatch && nextLinkMatch[1]) {
      const nextUrl = normalizeUrl(nextLinkMatch[1], baseUrl);
      if (nextUrl && nextUrl !== currentUrl) {
        const nextRes = await fetchWithTimeout(nextUrl, { headers: buildHeaders(currentUrl) }, 10000);
        if (nextRes.ok) {
          currentUrl = nextUrl;
          html = await nextRes.text();
        }
      }
    }

    const sourceRegex = /<source\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = sourceRegex.exec(html)) !== null) {
      const src = normalizeUrl(m[1], baseUrl);
      const sizeMatch = m[0].match(/size=["']?(\d{3,4})p?["']?/i);
      const q = normalizeQualityLabel(sizeMatch ? sizeMatch[1] + 'p' : entry.quality || src);
      found.push({
        url: src,
        quality: q,
        referer: currentUrl
      });
    }

    const directBtnRegex = /<a\b[^>]*href=["'](https?:\/\/[^"']+\.(?:mp4|m3u8)(?:\?[^"']*)?)["'][^>]*>/gi;
    while ((m = directBtnRegex.exec(html)) !== null) {
      const src = normalizeUrl(m[1], baseUrl);
      const q = normalizeQualityLabel(entry.quality !== 'Auto' ? entry.quality : src);
      found.push({
        url: src,
        quality: q,
        referer: currentUrl
      });
    }

    if (found.length === 0) {
      const rawRegex = /(https?:\/\/[^\s"'<>\\]+?\.(?:mp4|m3u8)(?:\?[^\s"'<>\\]*)?)/gi;
      while ((m = rawRegex.exec(html)) !== null) {
        const src = m[1].replace(/\\/g, '');
        const q = normalizeQualityLabel(entry.quality !== 'Auto' ? entry.quality : src);
        found.push({
          url: src,
          quality: q,
          referer: currentUrl
        });
      }
    }
  } catch (e) {
    console.log('[Akoam] Resolve link error:', e.message);
  }

  return found;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  try {
    await syncRemoteConfig();

    const baseUrl = getBaseUrl();
    const type = mediaType === 'movie' ? 'movie' : 'tv';

    const meta = await resolveMetadata(tmdbId, type);
    if (!meta || !meta.title) {
      console.log('[Akoam] Could not resolve metadata for ID:', tmdbId);
      return [];
    }

    let targetUrl = await searchAkoam(meta, type, seasonNum);
    if (!targetUrl) {
      console.log('[Akoam] No search results found for:', meta.title);
      return [];
    }

    if (type === 'tv' && episodeNum) {
      targetUrl = await resolveEpisodeUrl(targetUrl, episodeNum);
      if (!targetUrl) {
        console.log('[Akoam] Episode not found E' + episodeNum);
        return [];
      }
    }

    const pageRes = await fetchWithTimeout(targetUrl, { headers: buildHeaders(baseUrl + '/') });
    if (!pageRes.ok) {
      console.log('[Akoam] Page status:', pageRes.status);
      return [];
    }

    const pageHtml = await pageRes.text();
    const actionLinks = extractAkoamActionLinks(pageHtml, baseUrl);
    if (actionLinks.length === 0) {
      return [];
    }

    const resolvedBatches = await Promise.all(
      actionLinks.map(function (entry) {
        return resolveAkoamFinalStream(entry, targetUrl, baseUrl);
      })
    );

    const streams = [];
    const seen = {};

    resolvedBatches.forEach(function (batch) {
      batch.forEach(function (item) {
        if (!item.url || seen[item.url]) return;
        seen[item.url] = true;
        const streamType = item.url.indexOf('.m3u8') !== -1 ? 'HLS' : 'MP4';

        streams.push({
          name: 'Akoam',
          title: '🎬 Akoam • ' + item.quality + ' [Direct - ' + streamType + ']',
          url: item.url,
          quality: item.quality,
          headers: {
            Referer: item.referer || targetUrl,
            Origin: baseUrl,
            'User-Agent': USER_AGENT
          },
          provider: 'akoam'
        });
      });
    });

    streams.sort(function (a, b) {
      return qualityScore(b.quality) - qualityScore(a.quality);
    });

    return streams;
  } catch (error) {
    console.log('[Akoam] Error:', error && error.message ? error.message : error);
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
