const {
  CHAPTER_TTL,
  DEFAULT_TTL,
  fetchHTML: fetchHTMLDocument,
  isCloudflareBlocked: isFetcherCloudflareBlocked,
} = require("../src/utils/fetcher");
const loadEnv = require("../utils/loadEnv");

loadEnv();

const BASE_URL = "https://doujindesu.tv";

const RESERVED_SEGMENTS = new Set([
  "",
  "api",
  "author",
  "category",
  "character",
  "genre",
  "group",
  "login",
  "manga",
  "page",
  "partner",
  "register",
  "series",
  "tag",
  "wp-admin",
  "wp-content",
  "wp-includes",
]);

async function fetchHTML(url, options = {}) {
  const absolute = absoluteUrl(url);
  const ttl = options.ttl || DEFAULT_TTL;
  const $ = await fetchHTMLDocument(absolute, { ...options, ttl });
  return $.html();
}

function isCloudflareChallenge(html) {
  return isCloudflareBlocked(html);
}

function isCloudflareBlocked(html) {
  return isFetcherCloudflareBlocked(html);
}

function absoluteUrl(path) {
  if (!path || typeof path !== "string") return "";
  const value = path.trim();
  if (!value || value.startsWith("data:")) return "";

  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return "";
  }
}

function extractSlug(url) {
  if (!url) return "";
  const clean = decodeURIComponent(String(url)).trim();

  try {
    const parsed = new URL(clean, BASE_URL);
    const segments = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (segments[0] === "manga" && segments[1]) return safeSlug(segments[1]);
    return safeSlug(segments[segments.length - 1] || "");
  } catch {
    const segments = clean.split(/[?#]/)[0].replace(/\/+$/, "").split("/").filter(Boolean);
    return safeSlug(segments[segments.length - 1] || "");
  }
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function safeSlug(value) {
  return normalizeText(value)
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 180);
}

function parseListItems($, options = {}) {
  const results = [];
  const seen = new Set();
  const cardSelectors = [
    ".post",
    ".entry",
    ".animepost",
    ".bs",
    ".listupd .bs",
    ".listupd article",
    ".items article",
    ".item",
    ".thumb",
    "article",
  ];

  const cards = $(cardSelectors.join(",")).toArray();
  const fallbackCards = $("a[href]")
    .filter((_, element) => $(element).find("img").length > 0)
    .toArray();

  [...cards, ...fallbackCards].forEach((element) => {
    const root = $(element);
    const anchor = findBestDetailAnchor($, root);
    const url = absoluteUrl(anchor.attr("href"));
    const slug = extractSlug(url);

    if (!slug || seen.has(slug) || !isContentUrl(url)) return;

    const img = root.find("img").first();
    const title =
      normalizeText(anchor.attr("title")) ||
      normalizeText(root.find("h2, h3, .tt, .title, .entry-title").first().text()) ||
      normalizeText(img.attr("alt")) ||
      normalizeText(anchor.text());
    if (!title) return;

    const cover = getImageUrl($, img);
    const latestChapter = parseLatestChapter($, root, url);
    const type =
      normalizeType(root.find(".type, .posttype, .mta, .meta, .tpe1_inf").first().text()) ||
      normalizeType(root.text()) ||
      options.type ||
      "";

    seen.add(slug);
    results.push({
      title: cleanTitle(title),
      slug,
      url,
      cover,
      type,
      rating: parseRating(root.text()),
      latestChapter,
      updatedAt: normalizeText(
        root.find(".date, time, .time, .updated, .chapterdate, .epxs").first().text()
      ),
    });
  });

  return results;
}

function parseDetail($, slug) {
  const normalizedSlug = extractSlug(slug);
  const url = `${BASE_URL}/${normalizedSlug}/`;
  const title = cleanTitle(
    normalizeText($("h1, .entry-title, .post-title, .title").first().text()) ||
      normalizeText($('meta[property="og:title"]').attr("content")).replace(
        /\s*-\s*Doujindesu.*$/i,
        ""
      )
  );
  const bodyText = normalizeText($("body").text());
  const info = parseInfo($);
  const genres = parseTaxonomy($, "/genre/");
  const tags = parseTaxonomy($, "/tag/");
  const chapters = parseChapters($, normalizedSlug);

  return {
    title,
    slug: normalizedSlug,
    url,
    cover:
      absoluteUrl($('meta[property="og:image"]').attr("content")) ||
      getImageUrl($, $(".thumb img, .cover img, .info img, article img, main img").first()),
    description:
      normalizeText($(".entry-content p, .sinopsis p, .synopsis p, .desc, article p").first().text()) ||
      normalizeText($('meta[name="description"]').attr("content")),
    type: normalizeType(info.Type || info.type || bodyText),
    rating: info.Rating || parseRating(bodyText),
    status: info.Status || "",
    author: info.Author || info.Pengarang || "",
    artist: info.Artist || "",
    genres,
    tags,
    chapters,
  };
}

async function parseChapter($, slug) {
  const normalizedSlug = extractSlug(slug);
  const images = collectChapterImages($);

  return {
    title:
      cleanTitle(normalizeText($("h1, .entry-title, .post-title, .title").first().text())) ||
      normalizedSlug,
    slug: normalizedSlug,
    images,
    prevChapter: parseNavChapter($, "prev"),
    nextChapter: parseNavChapter($, "next"),
  };
}

function getImageUrl($, img) {
  if (!img || !img.length) return "";
  const src =
    img.attr("data-src") ||
    img.attr("data-lazy-src") ||
    img.attr("data-original") ||
    firstSrcset(img.attr("data-srcset") || img.attr("srcset")) ||
    img.attr("src");
  return absoluteUrl(src);
}

function firstSrcset(srcset) {
  return String(srcset || "").split(",")[0]?.trim().split(/\s+/)[0] || "";
}

function findBestDetailAnchor($, root) {
  const direct = root.is("a[href]") ? root : root.find("a[href]").first();
  const imageParent = root.find("img").first().closest("a[href]");

  return [imageParent, direct, ...root.find("a[href]").toArray().map((item) => $(item))]
    .find((anchor) => anchor && anchor.length && isContentUrl(absoluteUrl(anchor.attr("href")))) ||
    direct;
}

function parseLatestChapter($, root, detailUrl) {
  const links = root
    .find("a[href]")
    .toArray()
    .map((element) => $(element))
    .filter((anchor) => {
      const href = absoluteUrl(anchor.attr("href"));
      if (!href || href === detailUrl) return false;
      const text = normalizeText(anchor.text());
      return /chapter|ch\.|eps|episode/i.test(text) || /chapter|ch-/i.test(href);
    });

  const anchor = links[0];
  if (!anchor) return null;

  const url = absoluteUrl(anchor.attr("href"));
  return {
    title: normalizeText(anchor.text()) || extractSlug(url),
    slug: extractSlug(url),
    url,
  };
}

function parseInfo($) {
  const info = {};
  $("table tr, .info tr, .spe tr, .metadata tr").each((_, element) => {
    const cells = $(element).find("td, th");
    const key = normalizeText(cells.first().text()).replace(/:$/, "");
    const value = normalizeText(cells.last().text());
    if (key && value && key !== value) info[key] = value;
  });

  const bodyText = normalizeText($("body").text());
  ["Status", "Type", "Author", "Artist", "Rating"].forEach((label) => {
    if (info[label]) return;
    const match = bodyText.match(new RegExp(`${label}\\s*:?\\s*([^\\n|]+?)(?:\\s{2,}| Genre| Tag| Chapter|$)`, "i"));
    if (match?.[1]) info[label] = normalizeText(match[1]);
  });

  return info;
}

function parseTaxonomy($, path) {
  const seen = new Set();
  return $(`a[href*="${path}"]`)
    .toArray()
    .map((element) => ({
      name: normalizeText($(element).text()),
      slug: extractSlug($(element).attr("href")),
      url: absoluteUrl($(element).attr("href")),
    }))
    .filter((item) => {
      if (!item.name || !item.slug || seen.has(item.slug)) return false;
      seen.add(item.slug);
      return true;
    })
    .map((item) => item.name);
}

function parseChapters($, detailSlug) {
  const seen = new Set();
  const chapters = [];

  $("a[href]").each((_, element) => {
    const anchor = $(element);
    const url = absoluteUrl(anchor.attr("href"));
    const slug = extractSlug(url);
    const text = normalizeText(anchor.text()) || normalizeText(anchor.attr("title"));
    const segments = pathSegments(url);

    if (!slug || seen.has(slug) || slug === detailSlug) return;
    if (!isContentUrl(url) || RESERVED_SEGMENTS.has(segments[0])) return;
    if (!/chapter|ch\.|episode|eps|\b\d+(?:\.\d+)?\b/i.test(`${text} ${slug}`)) return;

    const row = anchor.closest("tr, li, .eps, .eplister, .chapter, .episodelist, div");
    const uploaded = normalizeText(
      row.find("time, .date, .tanggalseries, .chapterdate, td").last().text()
    );

    seen.add(slug);
    chapters.push({
      title: cleanTitle(text) || `Chapter ${chapters.length + 1}`,
      chapter: parseChapterLabel(text, slug),
      slug,
      url,
      uploaded,
    });
  });

  return chapters;
}

function collectChapterImages($) {
  const candidates = [];
  const selectors = [
    ".reader-area img",
    ".reading-content img",
    ".entry-content img",
    "#reader img",
    "#anu img",
    "article img",
    "main img",
    "img",
  ];

  $(selectors.join(",")).each((_, element) => {
    const img = $(element);
    if (img.closest("header, footer, nav, .ads, .advert, .blox, .widget").length) return;
    const src = getImageUrl($, img);
    const alt = normalizeText(img.attr("alt"));
    if (isChapterImage(src, alt)) candidates.push(src);
  });

  return [...new Set(candidates)];
}

function parseNavChapter($, direction) {
  const selector =
    direction === "prev"
      ? 'a[rel="prev"], .prev a, a:contains("Prev"), a:contains("Sebelumnya")'
      : 'a[rel="next"], .next a, a:contains("Next"), a:contains("Selanjutnya")';
  const anchor = $(selector).first();
  const url = absoluteUrl(anchor.attr("href"));
  const slug = extractSlug(url);

  return slug
    ? {
        title: normalizeText(anchor.text()) || slug,
        slug,
        url,
      }
    : null;
}

function isContentUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url, BASE_URL);
    if (parsed.hostname.replace(/^www\./, "") !== new URL(BASE_URL).hostname) return false;
    const segments = pathSegments(url);
    const last = segments[segments.length - 1] || "";
    if (!last || RESERVED_SEGMENTS.has(last)) return false;
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|css|js|ico|zip|rar|pdf)$/i.test(last)) return false;
    return true;
  } catch {
    return false;
  }
}

function pathSegments(url) {
  try {
    return new URL(url, BASE_URL).pathname.split("/").filter(Boolean);
  } catch {
    return String(url || "").split(/[?#]/)[0].split("/").filter(Boolean);
  }
}

function isChapterImage(src, alt = "") {
  if (!src || !/\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(src)) return false;
  return !/(logo|avatar|icon|banner|\bads?\b|iklan|favicon|histats|lazy\.jpg)/i.test(
    `${src} ${alt}`
  );
}

function normalizeType(value) {
  const match = normalizeText(value).match(/\b(Doujinshi|Doujin|Manga|Manhwa)\b/i);
  if (!match) return "";
  const type = match[1].toLowerCase();
  if (type === "doujinshi") return "Doujin";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function parseRating(value) {
  const match = normalizeText(value).match(/(?:rating|score)\s*:?\s*([\d.]+)/i);
  return match?.[1] || "";
}

function parseChapterLabel(text, slug) {
  const match = normalizeText(`${text} ${slug}`).match(/chapter\s*([\d.]+)/i);
  return match?.[1] || "";
}

function cleanTitle(value) {
  return normalizeText(value)
    .replace(/^Baca\s+/i, "")
    .replace(/\s*-\s*Doujindesu.*$/i, "")
    .trim();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listFromUrl(url, type = "") {
  const $ = await fetchHTMLDocument(url);
  return parseListItems($, { type });
}

function notFound(res) {
  return res.status(404).json({ status: false, message: "Not Found" });
}

function fetchErrorMessage(error) {
  if (error?.statusCode === 503 || error?.response?.status === 403) {
    return "Doujindesu source is protected by Cloudflare. Set DOUJINDESU_COOKIE with a valid cf_clearance cookie, then restart the API server.";
  }

  return error?.message || "Gagal mengambil data";
}

function sendFetchError(res, error, fallback = "Gagal mengambil data") {
  const status =
    error?.statusCode === 503 || error?.response?.status === 403
      ? 503
      : error?.statusCode || error?.response?.status || 500;

  return res.status(status).json({
    status: false,
    message: status === 503 ? fetchErrorMessage(error) : error?.message || fallback,
  });
}

async function listFromCandidates(candidates, type = "") {
  let lastError;

  for (const candidate of candidates) {
    const url = typeof candidate === "string" ? candidate : candidate.url;
    const expectedType = typeof candidate === "string" ? type : candidate.type || type;
    const filterType = typeof candidate === "string" ? "" : candidate.filterType || "";

    try {
      let results = await listFromUrl(url, expectedType);
      if (filterType) {
        const normalizedType = normalizeType(filterType);
        results = results.filter((item) => normalizeType(item.type) === normalizedType);
      }
      if (results.length) return results;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return [];
}

async function settleList(promise) {
  try {
    return { results: await promise, error: null };
  } catch (error) {
    return { results: [], error: fetchErrorMessage(error) };
  }
}

async function getTypedList(req, res, type, url) {
  try {
    const results = await listFromCandidates(
      [
        url,
        {
          url: `${BASE_URL}/manga/`,
          type: "",
          filterType: type,
        },
      ],
      type
    );
    if (!results.length) return notFound(res);
    res.json({ status: true, source: "doujindesu", type: type.toLowerCase(), results });
  } catch (error) {
    sendFetchError(res, error);
  }
}

async function getDoujin(req, res) {
  try {
    const results = await listFromCandidates(
      [`${BASE_URL}/manga/?type=Doujinshi`, `${BASE_URL}/doujin/`],
      "Doujin"
    );
    if (!results.length) return notFound(res);
    res.json({ status: true, source: "doujindesu", type: "doujin", results });
  } catch (error) {
    sendFetchError(res, error);
  }
}

async function getManga(req, res) {
  return getTypedList(req, res, "Manga", `${BASE_URL}/manga/?type=Manga`);
}

async function getManhwa(req, res) {
  return getTypedList(req, res, "Manhwa", `${BASE_URL}/manga/?type=Manhwa`);
}

async function getLibrary(req, res) {
  try {
    const [doujin, manga, manhwa] = await Promise.all([
      settleList(
        listFromCandidates([`${BASE_URL}/manga/?type=Doujinshi`, `${BASE_URL}/doujin/`], "Doujin")
      ),
      settleList(
        listFromCandidates(
          [
            `${BASE_URL}/manga/?type=Manga`,
            { url: `${BASE_URL}/manga/`, type: "", filterType: "Manga" },
          ],
          "Manga"
        )
      ),
      settleList(
        listFromCandidates(
          [
            `${BASE_URL}/manga/?type=Manhwa`,
            { url: `${BASE_URL}/manga/`, type: "", filterType: "Manhwa" },
          ],
          "Manhwa"
        )
      ),
    ]);
    const seen = new Set();
    const results = [...doujin.results, ...manga.results, ...manhwa.results].filter((item) => {
      if (!item.slug || seen.has(item.slug)) return false;
      seen.add(item.slug);
      return true;
    });
    if (!results.length && [doujin, manga, manhwa].some((item) => item.error)) {
      return res.status(503).json({
        status: false,
        message: [doujin.error, manga.error, manhwa.error].filter(Boolean)[0],
      });
    }
    res.json({
      status: true,
      source: "doujindesu",
      results,
      errors: [doujin.error, manga.error, manhwa.error].filter(Boolean),
    });
  } catch (error) {
    sendFetchError(res, error);
  }
}

async function getHome(req, res) {
  try {
    const [manhwa, doujin, manga] = await Promise.all([
      settleList(
        listFromCandidates(
          [
            `${BASE_URL}/manga/?type=Manhwa`,
            { url: `${BASE_URL}/manga/`, type: "", filterType: "Manhwa" },
          ],
          "Manhwa"
        )
      ),
      settleList(
        listFromCandidates([`${BASE_URL}/manga/?type=Doujinshi`, `${BASE_URL}/doujin/`], "Doujin")
      ),
      settleList(
        listFromCandidates(
          [
            `${BASE_URL}/manga/?type=Manga`,
            { url: `${BASE_URL}/manga/`, type: "", filterType: "Manga" },
          ],
          "Manga"
        )
      ),
    ]);
    if (![manhwa, doujin, manga].some((item) => item.results.length)) {
      return res.status(503).json({
        status: false,
        message: [manhwa.error, doujin.error, manga.error].filter(Boolean)[0],
      });
    }
    res.json({
      status: true,
      source: "doujindesu",
      manhwa: manhwa.results,
      doujin: doujin.results,
      manga: manga.results,
      errors: [manhwa.error, doujin.error, manga.error].filter(Boolean),
    });
  } catch (error) {
    sendFetchError(res, error);
  }
}

async function getGenres(req, res) {
  try {
    const $ = await fetchHTMLDocument(`${BASE_URL}/genre/`);
    const seen = new Set();
    const results = $('a[href*="/genre/"]')
      .toArray()
      .map((element) => ({
        name: normalizeText($(element).text()),
        slug: extractSlug($(element).attr("href")),
        url: absoluteUrl($(element).attr("href")),
      }))
      .filter((item) => {
        if (!item.name || !item.slug || RESERVED_SEGMENTS.has(item.slug) || seen.has(item.slug)) {
          return false;
        }
        seen.add(item.slug);
        return true;
      });

    if (!results.length) return notFound(res);
    res.json({ status: true, results });
  } catch (error) {
    sendFetchError(res, error, "Gagal mengambil genre");
  }
}

async function getGenreDetail(req, res) {
  try {
    const slug = safeSlug(req.params.slug);
    const $ = await fetchHTMLDocument(`${BASE_URL}/genre/${slug}/`);
    const results = parseListItems($);
    if (!results.length) return notFound(res);
    res.json({
      status: true,
      slug,
      title: normalizeText($("h1, .entry-title, .page-title, .title").first().text()) || slug,
      results,
    });
  } catch (error) {
    sendFetchError(res, error, "Gagal mengambil genre");
  }
}

async function getDetail(req, res) {
  try {
    const slug = safeSlug(req.params.slug);
    const $ = await fetchHTMLDocument(`${BASE_URL}/manga/${slug}/`);
    const result = parseDetail($, slug);
    if (!result.title || !result.slug) return notFound(res);
    res.json({ status: true, result });
  } catch (error) {
    sendFetchError(res, error, "Gagal mengambil detail");
  }
}

async function getChapter(req, res) {
  try {
    const slug = safeSlug(req.params.slug);
    const $ = await fetchHTMLDocument(`${BASE_URL}/${slug}/`, {
      ttl: CHAPTER_TTL,
      requireReaderImages: true,
    });
    const result = await parseChapter($, slug);
    if (!result.images.length) return notFound(res);
    res.json({ status: true, result });
  } catch (error) {
    sendFetchError(res, error, "Gagal mengambil chapter");
  }
}

async function getSearch(req, res) {
  try {
    const query = normalizeText(req.query.q || "");
    if (!query) {
      return res.json({ status: true, query, results: [] });
    }
    const $ = await fetchHTMLDocument(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
    const results = parseListItems($);
    res.json({ status: true, query, results });
  } catch (error) {
    sendFetchError(res, error, "Gagal mencari data");
  }
}

async function getPopular(req, res) {
  try {
    const $ = await fetchHTMLDocument(`${BASE_URL}/`);
    let results = parseListItems($);

    if (!results.length) {
      const library = await Promise.all([
        listFromUrl(`${BASE_URL}/manga/?type=Doujinshi`, "Doujin").then(async (items) =>
          items.length ? items : listFromUrl(`${BASE_URL}/doujin/`, "Doujin")
        ),
        listFromUrl(`${BASE_URL}/manga/?type=Manga`, "Manga"),
        listFromUrl(`${BASE_URL}/manga/?type=Manhwa`, "Manhwa"),
      ]);
      results = library.flat();
    }

    res.json({ status: true, results });
  } catch (error) {
    sendFetchError(res, error, "Gagal mengambil popular");
  }
}

module.exports = {
  BASE_URL,
  fetchHTML,
  absoluteUrl,
  extractSlug,
  normalizeText,
  isCloudflareBlocked,
  isCloudflareChallenge,
  parseListItems,
  parseDetail,
  parseChapter,
  getDoujin,
  getManga,
  getManhwa,
  getLibrary,
  getHome,
  getGenres,
  getGenreDetail,
  getDetail,
  getChapter,
  getSearch,
  getPopular,
};
