/**
 * Nuvio Native Plugin - MySeed / ArabSeed Provider (v1.1.0)
 * مخصص لهيكلة موقع https://m.myseed.tv/ الفعلية:
 * - يستبعد روابط الـ SEO الوهمية (/video/12345.mp4 في head / og:video / ld+json)
 * - يجلب سيرفرات كل الجودات (1080p, 720p, 480p) عبر AJAX مع csrf__token
 * - يفك رابط السيرفر المباشر (/vids.php?t=...) ويعرض حجم الملف
 * - يفك تغليف السيرفرات الخارجية (/vid/?id=BASE64 و /vid.php?url=BASE64)
 * - يدعم استخراج الروابط من VOE و Vidara و Byse/Filemoon/Savefiles/Vidmoly
 * - يدعم جلب النسختين (مترجم + مدبلج) للأفلام عند توفرهما
 * متوافق 100% مع محرك Hermes داخل Nuvio بدون أي مكتبات خارجية
 */

const CONFIG = {
  DOMAINS_URL: 'https://raw.githubusercontent.com/minasaad94/nuvio-ar-plugin/main/domains.json',
  FALLBACK_BASE_URL: 'https://m.myseed.tv',
  TMDB_API_KEY: '',
  DOMAINS_CACHE_TTL_MS: 30 * 60 * 1000,
  TIMEOUT_MS: 13000,
  MAX_SERVERS_PER_QUALITY: 4,
  MAX_MOVIE_VERSIONS: 2 // يسمح بجلب المترجم والمدبلج معاً لو متاحين
};

const RUNTIME = {
  baseUrl: CONFIG.FALLBACK_BASE_URL.replace(/\/$/, ''),
  tmdbApiKey: CONFIG.TMDB_API_KEY,
  lastConfigFetch: 0
};

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

// ============================================================================
// أدوات مساعدة آمنة لمحرك Hermes (بدون atob أو مكتبات Node)
// ============================================================================

function getBaseUrl() {
  return (RUNTIME.baseUrl || CONFIG.FALLBACK_BASE_URL)
    .replace(/\/main\/?$/i, '')
    .replace(/\/$/, '');
}

function getTmdbApiKey() {
  return (CONFIG.TMDB_API_KEY || RUNTIME.tmdbApiKey || '').trim();
}

function base64Decode(input) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = String(input || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[\r\n\s=]+$/g, '');
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

function stripHeadAndSchema(html) {
  if (!html) return '';
  return String(html)
    .replace(/<head\b[\s\S]*?<\/head>/gi, '')
    .replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, '');
}

// استبعاد الروابط الوهمية أو غير القابلة للتشغيل (مثل /video/851555.mp4 الخاص بالـ SEO)
function isFakeOrInvalidMediaUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return true;
  if (/\.(?:jpg|jpeg|png|webp|gif|svg|vtt|srt|js|css|ico|woff2?)(?:\?|$)/i.test(url)) return true;
  if (/myseed\.tv\/video\/\d+\.mp4(?:\?|$)/i.test(url)) return true;
  if (/arabseed\.[^/]+\/video\/\d+\.mp4(?:\?|$)/i.test(url)) return true;
  if (/\/video\/\d{4,}\.mp4(?:\?|$)/i.test(url) && url.indexOf(getOriginFromUrl(getBaseUrl())) !== -1) {
    return true;
  }
  return false;
}

// فك تغليف روابط myseed.pics/vid/?id=BASE64 و /vid.php?url=BASE64
function unwrapMySeedEmbedUrl(url, baseUrl) {
  const normalized = normalizeUrl(url, baseUrl);
  const idMatch = normalized.match(/\/vid\/\?id=([A-Za-z0-9\-_=]+)/i);
  if (idMatch && idMatch[1]) {
    const decoded = base64Decode(idMatch[1]).trim();
    if (/^https?:\/\//i.test(decoded)) {
      return decoded;
    }
  }
  const urlMatch = normalized.match(/\/vid\.php\?url=([A-Za-z0-9\-_=]+)/i);
  if (urlMatch && urlMatch[1]) {
    const decoded = base64Decode(urlMatch[1]).trim();
    if (/^https?:\/\//i.test(decoded)) {
      return decoded;
    }
  }
  return normalized;
}

// فك تشفير سكربتات المشغلات الشائعة (Dean Edwards p,a,c,k,e,d)
function unpackDeanEdwards(source) {
  let result = '';
  const regex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/g;
  let packedMatch;

  while ((packedMatch = regex.exec(source)) !== null) {
    try {
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
      result += '\n' + p;
    } catch (e) {}
  }
  return result;
}

// مزامنة الدومين من domains.json المركزي
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
// 1. جلب بيانات الفيلم / المسلسل (الاسم + السنة)
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
// 2. البحث داخل m.myseed.tv (باستخدام مسار الموقع الرسمي /find/?word=...)
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
      return w.length > 1;
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
  if (mediaType === 'movie' && isSeries) score -= 25;
  if (mediaType === 'tv' && !isSeries) score -= 25;

  if (mediaType === 'tv' && seasonNum) {
    const sPattern = new RegExp('(?:الموسم|موسم|season|s)\\s*0*' + seasonNum + '(?!\\d)', 'i');
    if (sPattern.test(candidate.title) || sPattern.test(urlDecoded)) {
      score += 25;
    }
  }

  // أفضلية خفيفة للنسخة المترجمة كأول خيار (مع الاحتفاظ بالمدبلجة كخيار ثانٍ)
  if (mediaType === 'movie' && candTitle.includes('مترجم')) {
    score += 5;
  }

  return score;
}

function parseSearchResults(html, baseUrl) {
  const bodyHtml = stripHeadAndSchema(html);
  const candidates = [];
  const seen = {};

  function pushCandidate(rawHref, rawTitle) {
    const href = normalizeUrl(rawHref, baseUrl);
    if (!href || seen[href]) return;
    if (!/^https?:\/\//i.test(href)) return;
    if (/\/(category|tag|page|find|main|home|recently|trend|orders|movies|series|wp-content|wp-admin|actor|director|genre)\/?$/i.test(href)) {
      return;
    }
    if (/\/(category|tag|actor|director|genre)\//i.test(href)) return;
    if (href.replace(/\/$/, '') === baseUrl.replace(/\/$/, '')) return;

    const cleanTitle = decodeHtmlEntities(String(rawTitle || '').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();

    seen[href] = true;
    candidates.push({
      url: href,
      title: cleanTitle || safeDecodeURIComponent(href),
      isDubbed: /مدبلج/i.test(cleanTitle + ' ' + safeDecodeURIComponent(href))
    });
  }

  // النمط الفعلي المؤكد في m.myseed.tv: <a href="..." title="..." class="movie__block">
  const anchorBlockRegex = /<a\b[^>]*class=["'][^"']*movie__block[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorBlockRegex.exec(bodyHtml)) !== null) {
    const tag = m[0];
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const titleMatch =
      tag.match(/title=["']([^"']+)["']/i) ||
      m[1].match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i);
    pushCandidate(hrefMatch[1], titleMatch ? titleMatch[1] : m[1]);
  }

  // Fallback لكروت إضافية
  if (candidates.length === 0) {
    const blockRegex = /<(?:div|li|article)\b[^>]*class=["'][^"']*(?:MovieBlock|item__contents|BlockItem|post)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|li|article)>/gi;
    while ((m = blockRegex.exec(bodyHtml)) !== null) {
      const block = m[0];
      const hrefMatch = block.match(/<a\b[^>]*href=["']([^"']+)["']/i);
      if (!hrefMatch) continue;
      const titleMatch =
        block.match(/title=["']([^"']+)["']/i) ||
        block.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i);
      pushCandidate(hrefMatch[1], titleMatch ? titleMatch[1] : '');
    }
  }

  return candidates;
}

async function searchMySeed(meta, mediaType, seasonNum) {
  const baseUrl = getBaseUrl();
  const typeParam = mediaType === 'movie' ? 'movies' : 'series';
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

    // المسار الرسمي في m.myseed.tv هو /find/?word=...&type=movies|series
    const searchUrls = [
      baseUrl + '/find/?word=' + encoded + '&type=' + typeParam,
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
          candidates.forEach(function (c) {
            c._score = scoreCandidate(c, meta, mediaType, seasonNum);
          });
          candidates.sort(function (a, b) {
            return b._score - a._score;
          });

          const topScore = candidates[0]._score;
          if (topScore < 30) continue;

          if (mediaType === 'movie') {
            const selected = [candidates[0]];
            // لو فيه نسخة تانية بنفس العنوان (مثلاً مترجم + مدبلج مصري)، نضيفها كمان
            for (let k = 1; k < candidates.length && selected.length < CONFIG.MAX_MOVIE_VERSIONS; k++) {
              if (
                candidates[k]._score >= topScore - 15 &&
                candidates[k].isDubbed !== candidates[0].isDubbed
              ) {
                selected.push(candidates[k]);
              }
            }
            return selected;
          }

          return [candidates[0]];
        }
      } catch (e) {
        console.log('[MySeed] Search request failed:', e.message);
      }
    }
  }

  return [];
}

// ============================================================================
// 3. الوصول إلى الموسم والحلقة في المسلسلات
// ============================================================================

async function resolveEpisodeUrl(seriesUrl, seasonNum, episodeNum) {
  const baseUrl = getBaseUrl();
  const res = await fetchWithTimeout(seriesUrl, { headers: buildHeaders(baseUrl + '/main/') });
  if (!res.ok) return null;

  let html = stripHeadAndSchema(await res.text());
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
            html = stripHeadAndSchema(await sRes.text());
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

    // نمط رابط الحلقات الفعلي في m.myseed.tv: -s1-eps8/
    const slugEpMatch = decodedHref.match(/eps0*(\d+)\/?$/i);
    if (slugEpMatch && parseInt(slugEpMatch[1], 10) === Number(episodeNum)) {
      if (!seasonNum || decodedHref.indexOf('s' + seasonNum + '-') !== -1 || decodedHref.indexOf('s0' + seasonNum + '-') !== -1) {
        return href;
      }
    }

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
// 4. قراءة قائمة السيرفرات والجودات من صفحة /watch/ (بما فيها AJAX للـ 720p و 1080p)
// ============================================================================

function parseServerListItems(htmlFragment, baseUrl, fallbackQuality) {
  const servers = [];
  const seenLinks = {};
  const liRegex = /<li\b([^>]*data-link=["'][^"']+["'][^>]*)>([\s\S]*?)<\/li>/gi;
  let m;

  while ((m = liRegex.exec(htmlFragment)) !== null) {
    const attrs = m[1];
    const inner = m[2];

    const linkMatch = attrs.match(/data-link=["']([^"']+)["']/i);
    if (!linkMatch || !linkMatch[1]) continue;

    const rawLink = normalizeUrl(linkMatch[1], baseUrl);
    if (seenLinks[rawLink]) continue;
    seenLinks[rawLink] = true;

    const quMatch = attrs.match(/data-qu=["'](\d+)["']/i);
    const nameMatch = attrs.match(/data-server-name=["']([^"']+)["']/i);
    const sizeMatch = attrs.match(/data-file-size=["']([^"']*)["']/i);
    const directMatch = attrs.match(/data-direct-arabseed=["'](\d)["']/i);

    const serverName = nameMatch
      ? decodeHtmlEntities(nameMatch[1]).trim()
      : decodeHtmlEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() || 'Server';

    const quality = quMatch ? quMatch[1] + 'p' : fallbackQuality || 'Auto';

    servers.push({
      rawLink: rawLink,
      unwrappedLink: unwrapMySeedEmbedUrl(rawLink, baseUrl),
      quality: normalizeQualityLabel(quality),
      name: serverName,
      fileSize: sizeMatch ? decodeHtmlEntities(sizeMatch[1]).trim() : '',
      isDirectMySeed: directMatch ? directMatch[1] === '1' : rawLink.indexOf('/vids.php') !== -1
    });
  }

  return servers;
}

function extractAvailableQualities(watchHtml) {
  const qualities = [];
  const seen = {};
  const qRegex = /<li\b[^>]*data-quality=["'](\d+)["'][^>]*>/gi;
  let m;
  while ((m = qRegex.exec(watchHtml)) !== null) {
    const q = m[1];
    if (!seen[q]) {
      seen[q] = true;
      qualities.push(q);
    }
  }
  qualities.sort(function (a, b) {
    return parseInt(b, 10) - parseInt(a, 10);
  });
  return qualities;
}

async function fetchServersForQuality(baseUrl, watchUrl, postId, csrfToken, qualityNum) {
  const formBody =
    'post_id=' +
    encodeURIComponent(postId) +
    '&quality=' +
    encodeURIComponent(qualityNum) +
    (csrfToken ? '&csrf_token=' + encodeURIComponent(csrfToken) : '');

  const endpoints = [
    baseUrl + '/get__quality__servers/',
    baseUrl + '/get__watch__server/'
  ];

  for (let i = 0; i < endpoints.length; i++) {
    try {
      const body =
        i === 1
          ? formBody + '&server=0'
          : formBody;

      const res = await fetchWithTimeout(
        endpoints[i],
        {
          method: 'POST',
          headers: buildHeaders(watchUrl, {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            Origin: baseUrl
          }),
          body: body
        },
        8000
      );

      if (!res.ok) continue;
      const txt = await res.text();
      if (!txt) continue;

      let htmlPayload = txt;
      try {
        const parsed = JSON.parse(txt);
        if (parsed.html) htmlPayload = parsed.html;
        else if (parsed.servers) htmlPayload = parsed.servers;
        else if (parsed.server && typeof parsed.server === 'string') {
          const unwrapped = unwrapMySeedEmbedUrl(parsed.server, baseUrl);
          return [
            {
              rawLink: normalizeUrl(parsed.server, baseUrl),
              unwrappedLink: unwrapped,
              quality: normalizeQualityLabel(qualityNum + 'p'),
              name: 'سيرفر ماي سيد المباشر',
              fileSize: parsed.file_size || '',
              isDirectMySeed: true
            }
          ];
        }
      } catch (e) {}

      const parsedItems = parseServerListItems(htmlPayload, baseUrl, qualityNum + 'p');
      if (parsedItems.length > 0) {
        return parsedItems;
      }
    } catch (e) {
      console.log('[MySeed] Quality AJAX failed (' + qualityNum + 'p):', e.message);
    }
  }

  return [];
}

// ============================================================================
// 5. استخراج روابط الفيديو الفعلية من السيرفر المباشر والمشغلات الخارجية
// ============================================================================

function collectMediaUrlsFromPlayerHtml(html, metaInfo, refererUrl, seen, streams) {
  function pushStream(rawUrl, qOverride) {
    const cleanUrl = decodeHtmlEntities(String(rawUrl || '').replace(/\\\//g, '/').trim());
    if (isFakeOrInvalidMediaUrl(cleanUrl)) return;
    if (seen[cleanUrl]) return;
    seen[cleanUrl] = true;

    // استخدام الجودة الحقيقية القادمة من تبويب الموقع أولاً
    const finalQuality =
      metaInfo.quality && metaInfo.quality !== 'Auto'
        ? metaInfo.quality
        : normalizeQualityLabel(qOverride || cleanUrl);

    const streamType = cleanUrl.indexOf('.m3u8') !== -1 ? 'HLS' : 'MP4';
    const versionTag = metaInfo.versionLabel ? ' • ' + metaInfo.versionLabel : '';
    const sizeTag = metaInfo.fileSize ? ' • ' + metaInfo.fileSize : '';

    streams.push({
      name: 'MySeed',
      title:
        '🎬 MySeed • ' +
        finalQuality +
        versionTag +
        sizeTag +
        '\n⚡ ' +
        metaInfo.serverName +
        ' [' +
        streamType +
        ']',
      url: cleanUrl,
      quality: finalQuality,
      headers: {
        Referer: refererUrl,
        Origin: getOriginFromUrl(refererUrl),
        'User-Agent': USER_AGENT
      },
      provider: 'myseed'
    });
  }

  const unpacked = unpackDeanEdwards(html);
  const combined = unpacked ? html + '\n' + unpacked : html;

  // 1) <source src="..."> و <video src="...">
  const sourceRegex = /<(?:source|video)\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = sourceRegex.exec(combined)) !== null) {
    const sizeMatch = m[0].match(/(?:size|label)=["']?(\d{3,4}p?)["']?/i);
    pushStream(m[1], sizeMatch ? sizeMatch[1] : '');
  }

  // 2) أنماط المشغلات: file: "...", hls: "...", mp4: "...", src: "..."
  const keyRegex =
    /["']?(?:file|hls|mp4|videoUrl|stream_url|source)["']?\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/gi;
  while ((m = keyRegex.exec(combined)) !== null) {
    pushStream(m[1], '');
  }

  // 3) نمط VOE: 'hls': 'BASE64' أو atob('BASE64')
  const b64FieldRegex = /["'](?:hls|mp4|file|source)["']\s*:\s*["']([A-Za-z0-9+/=\-_]{30,})["']/gi;
  while ((m = b64FieldRegex.exec(combined)) !== null) {
    const decoded = base64Decode(m[1]).trim();
    if (/^https?:\/\/.+\.(?:m3u8|mp4)/i.test(decoded)) {
      pushStream(decoded, '');
    }
  }

  const atobRegex = /atob\(\s*["']([A-Za-z0-9+/=\-_]{24,})["']\s*\)/gi;
  while ((m = atobRegex.exec(combined)) !== null) {
    const decoded = base64Decode(m[1]).trim();
    if (/^https?:\/\/.+\.(?:m3u8|mp4)/i.test(decoded)) {
      pushStream(decoded, '');
    }
  }

  // 4) روابط m3u8 / mp4 مباشرة داخل السكربت
  const rawRegex = /(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?)/gi;
  while ((m = rawRegex.exec(combined)) !== null) {
    pushStream(m[1], '');
  }
}

async function resolveEmbedServer(serverObj, watchUrl, baseUrl, versionLabel, seen, streams) {
  const metaInfo = {
    quality: serverObj.quality,
    serverName: serverObj.name,
    fileSize: serverObj.fileSize,
    versionLabel: versionLabel
  };

  // نبدأ بالرابط المفكوك (أو الرابط المباشر لـ /vids.php)
  const candidatesToTry = [];
  if (serverObj.isDirectMySeed) {
    candidatesToTry.push({ url: serverObj.rawLink, referer: watchUrl });
  } else {
    candidatesToTry.push({ url: serverObj.unwrappedLink, referer: serverObj.rawLink });
    if (serverObj.rawLink !== serverObj.unwrappedLink) {
      candidatesToTry.push({ url: serverObj.rawLink, referer: watchUrl });
    }
  }

  for (let idx = 0; idx < candidatesToTry.length; idx++) {
    const startCount = streams.length;
    const target = candidatesToTry[idx];

    try {
      // حالة خاصة لمشغل Vidara (يدعم API مباشر أحياناً)
      const vidaraMatch = target.url.match(/vidara\.[^/]+\/e\/([A-Za-z0-9]+)/i);
      if (vidaraMatch && vidaraMatch[1]) {
        try {
          const origin = getOriginFromUrl(target.url);
          const apiRes = await fetchWithTimeout(
            origin + '/api/stream?filecode=' + encodeURIComponent(vidaraMatch[1]),
            { headers: buildHeaders(target.url, { Accept: 'application/json' }) },
            7000
          );
          if (apiRes && apiRes.ok) {
            const apiTxt = await apiRes.text();
            collectMediaUrlsFromPlayerHtml(apiTxt, metaInfo, target.url, seen, streams);
          }
        } catch (e) {}
      }

      if (streams.length > startCount) return;

      const res = await fetchWithTimeout(target.url, { headers: buildHeaders(target.referer) }, 9500);
      if (!res || !res.ok) continue;

      const finalUrl = res.url || target.url;
      const contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || '';

      // لو السيرفر عمل Redirect مباشر لملف فيديو
      if (/video\/|mpegurl/i.test(contentType) || /\.(?:mp4|m3u8)(?:\?|$)/i.test(finalUrl)) {
        if (!isFakeOrInvalidMediaUrl(finalUrl) && !seen[finalUrl]) {
          seen[finalUrl] = true;
          const streamType = finalUrl.indexOf('.m3u8') !== -1 ? 'HLS' : 'MP4';
          const vTag = versionLabel ? ' • ' + versionLabel : '';
          const sTag = serverObj.fileSize ? ' • ' + serverObj.fileSize : '';
          streams.push({
            name: 'MySeed',
            title:
              '🎬 MySeed • ' +
              serverObj.quality +
              vTag +
              sTag +
              '\n⚡ ' +
              serverObj.name +
              ' [' +
              streamType +
              ']',
            url: finalUrl,
            quality: serverObj.quality,
            headers: {
              Referer: target.referer,
              Origin: getOriginFromUrl(target.referer),
              'User-Agent': USER_AGENT
            },
            provider: 'myseed'
          });
          return;
        }
      }

      const html = await res.text();
      collectMediaUrlsFromPlayerHtml(html, metaInfo, finalUrl, seen, streams);
      if (streams.length > startCount) return;

      // متابعة إعادة التوجيه عبر JS (شائعة جداً في VOE و vids.php) أو iframe داخلي
      const jsRedirectMatch =
        html.match(/window\.location\.href\s*=\s*["'](https?:\/\/[^"']+)["']/i) ||
        html.match(/location\.replace\(\s*["'](https?:\/\/[^"']+)["']\s*\)/i) ||
        html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+url=([^"';>\s]+)/i);

      const nestedIframeMatch = html.match(/<iframe\b[^>]*src=["']([^"']+)["']/i);
      const nextHopRaw = (jsRedirectMatch && jsRedirectMatch[1]) || (nestedIframeMatch && nestedIframeMatch[1]);

      if (nextHopRaw) {
        const nextHop = unwrapMySeedEmbedUrl(normalizeUrl(nextHopRaw, getOriginFromUrl(finalUrl)), baseUrl);
        if (
          /^https?:\/\//i.test(nextHop) &&
          nextHop !== finalUrl &&
          !/google|facebook|ads|disqus|cloudflare|llvpn/i.test(nextHop)
        ) {
          const res2 = await fetchWithTimeout(nextHop, { headers: buildHeaders(finalUrl) }, 8500);
          if (res2 && res2.ok) {
            const html2 = await res2.text();
            collectMediaUrlsFromPlayerHtml(html2, metaInfo, res2.url || nextHop, seen, streams);
          }
        }
      }

      if (streams.length > startCount) return;
    } catch (e) {
      console.log('[MySeed] Server probe error (' + serverObj.name + '):', e.message);
    }
  }
}

async function resolveWatchUrl(itemUrl, baseUrl) {
  if (/\/watch\/?$/i.test(itemUrl)) return itemUrl;
  try {
    const res = await fetchWithTimeout(itemUrl, { headers: buildHeaders(baseUrl + '/main/') });
    if (res.ok) {
      const html = stripHeadAndSchema(await res.text());
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

async function scrapeWatchPage(itemUrl, versionLabel, baseUrl, seen, streams) {
  const watchUrl = await resolveWatchUrl(itemUrl, baseUrl);
  const watchRes = await fetchWithTimeout(watchUrl, { headers: buildHeaders(itemUrl) });
  if (!watchRes.ok) {
    console.log('[MySeed] Watch page HTTP status:', watchRes.status);
    return;
  }

  const fullWatchHtml = await watchRes.text();
  const bodyHtml = stripHeadAndSchema(fullWatchHtml);

  // استخراج post_id و csrf__token من الصفحة
  const csrfMatch = fullWatchHtml.match(/['"]csrf__token['"]\s*:\s*['"]([^'"]+)['"]/i);
  const postIdMatch =
    bodyHtml.match(/data-post=["'](\d+)["']/i) ||
    fullWatchHtml.match(/['"]p(?:so|os)t_id['"]\s*:\s*['"](\d+)['"]/i) ||
    fullWatchHtml.match(/postid-(\d+)/i);

  const csrfToken = csrfMatch ? csrfMatch[1] : '';
  const postId = postIdMatch ? postIdMatch[1] : '';

  // 1) السيرفرات الظاهرة افتراضياً في الصفحة (مثلاً 480p)
  let allServers = parseServerListItems(bodyHtml, baseUrl, '');
  const loadedQualities = {};
  allServers.forEach(function (s) {
    const qDigits = String(s.quality).replace(/\D/g, '');
    if (qDigits) loadedQualities[qDigits] = true;
  });

  // 2) جلب سيرفرات باقي الجودات (1080p, 720p) عبر AJAX بالتوازي
  const availableQualities = extractAvailableQualities(bodyHtml);
  if (postId && availableQualities.length > 0) {
    const missingQualities = availableQualities.filter(function (q) {
      return !loadedQualities[q];
    });

    if (missingQualities.length > 0) {
      const qualityBatches = await Promise.all(
        missingQualities.map(function (q) {
          return fetchServersForQuality(baseUrl, watchUrl, postId, csrfToken, q);
        })
      );
      qualityBatches.forEach(function (batch) {
        allServers = allServers.concat(batch);
      });
    }
  }

  // Fallback لو مفيش <li> بس فيه iframe جاهز في الصفحة
  if (allServers.length === 0) {
    const frameMatch = bodyHtml.match(/<iframe\b[^>]*id=["']video_frame["'][^>]*src=["']([^"']+)["']/i);
    if (frameMatch && frameMatch[1]) {
      const raw = normalizeUrl(frameMatch[1], baseUrl);
      allServers.push({
        rawLink: raw,
        unwrappedLink: unwrapMySeedEmbedUrl(raw, baseUrl),
        quality: 'Auto',
        name: 'سيرفر ماي سيد المباشر',
        fileSize: '',
        isDirectMySeed: raw.indexOf('/vids.php') !== -1
      });
    }
  }

  // ترتيب السيرفرات: أعلى جودة أولاً، ثم السيرفر المباشر أولاً داخل كل جودة
  allServers.sort(function (a, b) {
    const qDiff = qualityScore(b.quality) - qualityScore(a.quality);
    if (qDiff !== 0) return qDiff;
    if (a.isDirectMySeed !== b.isDirectMySeed) return a.isDirectMySeed ? -1 : 1;
    return 0;
  });

  // اختيار أفضل السيرفرات لكل جودة (للحفاظ على سرعة الاستجابة)
  const perQualityCount = {};
  const selectedServers = [];
  allServers.forEach(function (srv) {
    const key = srv.quality;
    perQualityCount[key] = (perQualityCount[key] || 0) + 1;
    if (perQualityCount[key] <= CONFIG.MAX_SERVERS_PER_QUALITY) {
      selectedServers.push(srv);
    }
  });

  await Promise.all(
    selectedServers.map(function (srv) {
      return resolveEmbedServer(srv, watchUrl, baseUrl, versionLabel, seen, streams);
    })
  );
}

// ============================================================================
// 6. الدالة الرئيسية التي يستدعيها تطبيق Nuvio
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

    const matchedItems = await searchMySeed(meta, type, seasonArg);
    if (!matchedItems || matchedItems.length === 0) {
      console.log('[MySeed] No search results for:', meta.title);
      return [];
    }

    const streams = [];
    const seen = {};

    if (type === 'tv' && episodeArg) {
      const epUrl = await resolveEpisodeUrl(matchedItems[0].url, seasonArg, episodeArg);
      if (!epUrl) {
        console.log('[MySeed] Episode not found S' + seasonArg + 'E' + episodeArg);
        return [];
      }
      await scrapeWatchPage(epUrl, '', baseUrl, seen, streams);
    } else {
      await Promise.all(
        matchedItems.map(function (item) {
          const label = item.isDubbed ? 'مدبلج' : 'مترجم';
          return scrapeWatchPage(item.url, label, baseUrl, seen, streams);
        })
      );
    }

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
