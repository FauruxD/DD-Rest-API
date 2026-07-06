const {
  CHAPTER_TTL,
  DEFAULT_TTL,
  fetchHTML: fetchHTMLDocument,
  isCloudflareBlocked: isFetcherCloudflareBlocked,
} = require("../src/utils/fetcher");
const loadEnv = require("../utils/loadEnv");

loadEnv();

const BASE_URL = "https://komiktap.info";
const COMIC_LIST_PAGE_SIZE = 15;

const RESERVED_SEGMENTS = new Set([
  "",
  "api",
  "a-z-list",
  "bookmark",
  "category",
  "donasi",
  "genre",
  "genres",
  "komik",
  "list-manga",
  "list-manhua",
  "list-manhwa",
  "login",
  "manga",
  "ongoing",
  "page",
  "project",
  "random-komik",
  "register",
  "tag",
  "tamat",
  "wp-admin",
  "wp-content",
  "wp-includes",
]);
const CHAPTER_IMAGE_SELECTORS = [
  "#readerarea img",
  ".ts-main-image",
  ".reading-content img",
  ".readerarea img",
  ".reader-area img",
  "#reader img",
  ".chapter-content img",
];
const CHAPTER_IMAGE_FALLBACK_SELECTORS = [
  ".entry-content img",
  "article img",
  "main img",
];
const IMAGE_SOURCE_ATTRIBUTES = [
  "data-src",
  "data-lazy-src",
  "data-original",
  "data-cfsrc",
  "data-pagespeed-lazy-src",
  "data-full",
  "data-url",
  "data-img",
  "data-image",
  "data-large-file",
  "data-medium-file",
];
const NON_READER_IMAGE_RE =
  /(?:logo|avatar|icon|banner|\bads?\b|iklan|favicon|histats|lazy\.jpg|readerarea\.svg|gravatar|cdnfgo|slot|judi|casino|sbobet|dewa|hoki|bandar|klik|mamba|wongso|zeon|kpsbanner|promo)/i;
const CATEGORY_PATHS = {
  manga: { path: "list-manga", type: "Manga" },
  manhwa: { path: "list-manhwa", type: "Manhwa" },
  manhua: { path: "list-manhua", type: "Manhua" },
};

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
  return extractDetailSlug(url);
}

function extractDetailSlug(url) {
  if (!url) return "";
  const segments = pathSegments(url);
  if (!segments.length) return "";

  if (["manga", "komik", "series"].includes(segments[0]) && segments[1]) {
    return safeSlug(segments[1]);
  }

  return safeSlug(segments[0] || segments[segments.length - 1] || "");
}

function extractChapterSlug(url) {
  const segments = pathSegments(url);
  return safeSlug(segments[segments.length - 1] || "");
}

function extractLastSlug(url) {
  const segments = pathSegments(url);
  return safeSlug(segments[segments.length - 1] || "");
}

function splitKomiktapChapterSlug(value) {
  const slug = safeSlug(value);
  const match = slug.match(/^(.+)-chapter-([\d.-]+)$/i);
  if (!match) return { mangaSlug: "", chapterNumber: "", chapterSlug: slug };

  return {
    mangaSlug: safeSlug(match[1]),
    chapterNumber: safeSlug(match[2].replace(/\./g, "-")),
    chapterSlug: slug,
  };
}

function buildChapterSlug(mangaSlug, chapter) {
  const normalizedManga = safeSlug(mangaSlug);
  const normalizedChapter = safeSlug(chapter);
  return normalizedManga && normalizedChapter
    ? `${normalizedManga}-chapter-${normalizedChapter.replace(/-/g, ".")}`
    : safeSlug(mangaSlug || chapter);
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
    ".bs",
    ".listupd .bs",
    ".utao",
    ".uta",
    ".bixbox article",
    ".postbody article",
    ".series",
    ".animepost",
    ".post",
    ".entry",
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
    const slug = extractDetailSlug(url);

    if (!slug || seen.has(slug) || !isDetailUrl(url)) return;

    const img = root.find("img").first();
    const title =
      cleanTitle(normalizeText(anchor.attr("title"))) ||
      cleanTitle(normalizeText(root.find("h2, h3, h4, .tt, .ttls, .title, .entry-title").first().text())) ||
      cleanTitle(normalizeText(img.attr("alt"))) ||
      cleanTitle(normalizeText(anchor.text()));
    if (!title) return;

    const cover = getImageUrl($, img);
    const latestChapter = parseLatestChapter($, root, url, slug);
    const type =
      normalizeType(root.find(".type, .posttype, .mta, .meta, .tpe1_inf, .limit .type").first().text()) ||
      normalizeType(root.text()) ||
      options.type ||
      "";

    seen.add(slug);
    results.push({
      title,
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

function parseDetail($, slug, sourceUrl = "") {
  const normalizedSlug = safeSlug(slug);
  const title = cleanTitle(
    normalizeText($('meta[property="og:title"]').attr("content")) ||
      normalizeText($("h1.entry-title, h1.post-title, h1.title, .infox h1, .seriestucon h1, h1").first().text())
  );
  const bodyText = normalizeText($("body").text());
  const info = parseInfo($);
  const genres = parseTaxonomy($, ["/genre/", "/genres/"]);
  const tags = parseTaxonomy($, ["/tag/"]);
  const chapters = parseChapters($, normalizedSlug);

  return {
    title,
    slug: normalizedSlug,
    url: sourceUrl || `${BASE_URL}/manga/${normalizedSlug}/`,
    cover:
      absoluteUrl($('meta[property="og:image"]').attr("content")) ||
      getImageUrl(
        $,
        $(".thumb img, .cover img, .info img, .infox img, .seriestucon img, .bigcover img, article img, main img").first()
      ),
    description:
      normalizeText($(".entry-content p, .seriestucontent .entry-content, .sinopsis p, .synopsis p, .desc, .summary, article p").first().text()) ||
      normalizeText($('meta[name="description"]').attr("content")),
    type: normalizeType(info.Type || info.Jenis || info.type || bodyText),
    rating: info.Rating || info.Score || parseRating(bodyText),
    status: info.Status || "",
    author: info.Author || info.Pengarang || "",
    artist: info.Artist || "",
    genres,
    tags,
    chapters,
  };
}

async function parseChapter($, chapterSlug, sourceUrl = "") {
  const normalizedSlug = safeSlug(chapterSlug);
  const chapterParts = splitKomiktapChapterSlug(normalizedSlug);
  const comic = parseChapterComic($, normalizedSlug) || {
    title: chapterParts.mangaSlug.replace(/-/g, " "),
    slug: chapterParts.mangaSlug,
    url: chapterParts.mangaSlug ? `${BASE_URL}/manga/${chapterParts.mangaSlug}/` : "",
  };
  const mangaSlug = comic.slug || chapterParts.mangaSlug;
  const chapterNumber = chapterParts.chapterNumber || parseChapterLabel("", normalizedSlug);
  const images = collectChapterImages($);

  return {
    title:
      cleanTitle(normalizeText($("h1.entry-title, h1.post-title, h1.title, .reader-area h1, h1").first().text())) ||
      (chapterNumber ? `Chapter ${chapterNumber}` : normalizedSlug),
    slug: normalizedSlug,
    chapter: chapterNumber,
    chapterNumber,
    url: sourceUrl || `${BASE_URL}/${normalizedSlug}/`,
    comic,
    mangaInfo: {
      title: comic.title,
      originalLink: comic.url,
      apiLink: mangaSlug ? `/api/detail/${mangaSlug}` : undefined,
      slug: mangaSlug,
    },
    images,
    meta: {
      chapterNumber,
      totalImages: images.length,
      slug: normalizedSlug,
      sourceUrl: sourceUrl || `${BASE_URL}/${normalizedSlug}/`,
    },
    prevChapter: parseNavChapter($, "prev"),
    nextChapter: parseNavChapter($, "next"),
    navigation: {
      prevChapter: parseNavChapter($, "prev"),
      nextChapter: parseNavChapter($, "next"),
      allChapters: mangaSlug ? `/api/detail/${mangaSlug}` : null,
    },
  };
}

function getImageUrl($, img) {
  if (!img || !img.length) return "";

  for (const attribute of IMAGE_SOURCE_ATTRIBUTES) {
    const value = img.attr(attribute);
    if (value) return absoluteUrl(value);
  }

  return absoluteUrl(
    firstSrcset(img.attr("data-srcset") || img.attr("srcset")) || img.attr("src")
  );
}

function firstSrcset(srcset) {
  return String(srcset || "").split(",")[0]?.trim().split(/\s+/)[0] || "";
}

function findBestDetailAnchor($, root) {
  const candidates = [
    root.is("a[href]") ? root : null,
    root.find("img").first().closest("a[href]"),
    ...root.find("a[href]").toArray().map((item) => $(item)),
  ].filter(Boolean);

  return candidates.find((anchor) => anchor.length && isDetailUrl(absoluteUrl(anchor.attr("href")))) || candidates[0] || root;
}

function parseLatestChapter($, root, detailUrl, mangaSlug = "") {
  const links = root
    .find("a[href]")
    .toArray()
    .map((element) => $(element))
    .filter((anchor) => {
      const href = absoluteUrl(anchor.attr("href"));
      if (!href || href === detailUrl) return false;
      return isChapterUrl(href, anchor.text());
    });

  const anchor = links[0];
  if (!anchor) return null;

  const url = absoluteUrl(anchor.attr("href"));
  const slug = extractChapterSlug(url);
  const chapter = parseChapterLabel(anchor.text(), slug);
  const sourceParts = splitKomiktapChapterSlug(slug);
  const normalizedMangaSlug = mangaSlug || sourceParts.mangaSlug;

  return {
    title: normalizeText(anchor.text()) || (chapter ? `Chapter ${chapter}` : slug),
    slug,
    url,
    chapter,
    chapterSlug: chapter,
    apiLink: normalizedMangaSlug && chapter ? `/api/chapter/${normalizedMangaSlug}/${chapter}` : `/api/chapter/${slug}`,
  };
}

function parseInfo($) {
  const info = {};
  $(".spe span, .infotable tr, table tr, .info tr, .metadata tr, .fmed, .imptdt").each((_, element) => {
    const row = $(element);
    const cells = row.find("td, th, span, b, i");
    let key = normalizeText(cells.first().text()).replace(/:$/, "");
    let value = normalizeText(cells.last().text());

    if (!key || key === value) {
      const text = normalizeText(row.text());
      const match = text.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        key = normalizeText(match[1]);
        value = normalizeText(match[2]);
      }
    }

    key = normalizeInfoKey(key);
    if (key && value && key !== value) info[key] = value;
  });

  const bodyText = normalizeText($("body").text());
  ["Status", "Type", "Jenis", "Author", "Pengarang", "Artist", "Rating", "Score"].forEach((label) => {
    if (info[normalizeInfoKey(label)]) return;
    const match = bodyText.match(new RegExp(`${label}\\s*:?\\s*([^\\n|]+?)(?:\\s{2,}| Genre| Tag| Chapter|$)`, "i"));
    if (match?.[1]) info[normalizeInfoKey(label)] = normalizeText(match[1]);
  });

  return info;
}

function normalizeInfoKey(key) {
  const normalized = normalizeText(key).replace(/:$/, "");
  if (/status/i.test(normalized)) return "Status";
  if (/author|pengarang/i.test(normalized)) return "Author";
  if (/artist|ilustrator/i.test(normalized)) return "Artist";
  if (/rating|score/i.test(normalized)) return "Rating";
  if (/type|jenis/i.test(normalized)) return "Type";
  return normalized;
}

function parseTaxonomy($, paths) {
  const seen = new Set();
  return paths
    .flatMap((path) =>
      $(`a[href*="${path}"]`)
        .toArray()
        .map((element) => ({
          name: normalizeText($(element).text()),
          slug: extractLastSlug($(element).attr("href")),
          url: absoluteUrl($(element).attr("href")),
        }))
    )
    .filter((item) => {
      if (!item.name || !item.slug || RESERVED_SEGMENTS.has(item.slug) || seen.has(item.slug)) return false;
      seen.add(item.slug);
      return true;
    })
    .map((item) => item.name);
}

function parseChapters($, detailSlug) {
  const seen = new Set();
  const chapters = [];

  $(".eplister li a[href], .episodelist li a[href], .clstyle a[href], .lchx a[href], .chapter a[href], a[href*='chapter']").each((_, element) => {
    const anchor = $(element);
    const url = absoluteUrl(anchor.attr("href"));
    const slug = extractChapterSlug(url);
    const text = normalizeText(anchor.text()) || normalizeText(anchor.attr("title"));

    if (!slug || seen.has(slug) || slug === detailSlug) return;
    if (!isChapterUrl(url, text)) return;

    const row = anchor.closest("tr, li, .eps, .eplister, .chapter, .episodelist, .clstyle, .lchx, div");
    const uploaded = normalizeText(
      row.find("time, .date, .tanggalseries, .chapterdate, td, span").last().text()
    );
    const chapterNumber = parseChapterLabel(text, slug);

    seen.add(slug);
    chapters.push({
      title: cleanTitle(text) || (chapterNumber ? `Chapter ${chapterNumber}` : `Chapter ${chapters.length + 1}`),
      chapter: chapterNumber,
      chapterNumber,
      slug,
      url,
      originalLink: url,
      apiLink: detailSlug && chapterNumber ? `/api/chapter/${detailSlug}/${chapterNumber}` : `/api/chapter/${slug}`,
      uploaded,
    });
  });

  return chapters;
}

function collectChapterImages($) {
  const primaryImages = collectImagesFromSelectors($, CHAPTER_IMAGE_SELECTORS);
  if (primaryImages.length) return primaryImages;

  return collectImagesFromSelectors($, CHAPTER_IMAGE_FALLBACK_SELECTORS);
}

function collectImagesFromSelectors($, selectors) {
  const candidates = [];

  $(selectors.join(",")).each((_, element) => {
    const img = $(element);
    if (img.closest("header, footer, nav, .ads, .advert, .blox, .widget, .sidebar, .wpd-comment").length) return;

    const src = getImageUrl($, img);
    const alt = normalizeText(img.attr("alt"));
    const context = [
      img.attr("class"),
      img.attr("id"),
      img.parent().attr("class"),
      img.closest("div, article, main").attr("id"),
      img.closest("div, article, main").attr("class"),
    ].join(" ");

    if (isChapterImage(src, alt, context)) candidates.push(src);
  });

  return [...new Set(candidates)];
}

function parseNavChapter($, direction) {
  const selector =
    direction === "prev"
      ? 'a[rel="prev"], .prev a, .nav-previous a, a:contains("Prev"), a:contains("Sebelumnya")'
      : 'a[rel="next"], .next a, .nav-next a, a:contains("Next"), a:contains("Selanjutnya")';
  const anchor = $(selector)
    .filter((_, element) => isChapterUrl($(element).attr("href"), $(element).text()))
    .first();
  const url = absoluteUrl(anchor.attr("href"));
  const slug = extractChapterSlug(url);
  const chapterNumber = parseChapterLabel(anchor.text(), slug);
  const sourceParts = splitKomiktapChapterSlug(slug);
  const mangaSlug = sourceParts.mangaSlug;

  return slug
    ? {
        title: normalizeText(anchor.text()) || (chapterNumber ? `Chapter ${chapterNumber}` : slug),
        originalLink: url,
        apiLink: mangaSlug && chapterNumber ? `/api/chapter/${mangaSlug}/${chapterNumber}` : `/api/chapter/${slug}`,
        chapter: chapterNumber,
        chapterNumber,
        slug,
        url,
      }
    : null;
}

function parseChapterComic($, chapterSlug) {
  const chapterParts = splitKomiktapChapterSlug(chapterSlug);
  const anchor = $('a[href*="/manga/"]')
    .filter((_, element) => {
      const url = absoluteUrl($(element).attr("href"));
      const slug = extractDetailSlug(url);
      return isDetailUrl(url) && slug && slug !== chapterSlug;
    })
    .first();
  const url = absoluteUrl(anchor.attr("href"));
  const slug = extractDetailSlug(url) || chapterParts.mangaSlug;

  return slug
    ? {
        title: normalizeText(anchor.text()) || slug.replace(/-/g, " "),
        slug,
        url: url || `${BASE_URL}/manga/${slug}/`,
      }
    : null;
}

function isDetailUrl(url) {
  if (!isContentUrl(url)) return false;
  if (isChapterUrl(url)) return false;

  const segments = pathSegments(url);
  if (!segments.length) return false;
  if (segments.some((segment) => /^(chapter|ch|episode|eps)-?\d/i.test(segment))) return false;

  return true;
}

function isChapterUrl(url, text = "") {
  if (!isContentUrl(url)) return false;
  const segments = pathSegments(url);
  if (["manga", "komik", "series"].includes(segments[0]) && segments.length <= 2) return false;

  const last = segments[segments.length - 1] || "";
  const combined = `${url} ${text}`;

  return (
    /(?:^|[-/\s])chapter[-_\s]*\d/i.test(combined) ||
    /(?:^|[-/\s])ch[-_\s]*\d/i.test(combined) ||
    /(?:^|[-/\s])episode[-_\s]*\d/i.test(combined) ||
    /(?:^|[-/\s])eps[-_\s]*\d/i.test(combined) ||
    /\bchapter\b/i.test(combined) ||
    /^\d+(?:\.\d+)?$/.test(last)
  );
}

function isContentUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url, BASE_URL);
    if (parsed.hostname.replace(/^www\./, "") !== new URL(BASE_URL).hostname) return false;
    const segments = pathSegments(url);
    const first = segments[0] || "";
    const last = segments[segments.length - 1] || "";
    if (!last || RESERVED_SEGMENTS.has(last)) return false;
    if (RESERVED_SEGMENTS.has(first) && segments.length === 1) return false;
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

function isChapterImage(src, alt = "", context = "") {
  if (!src || !/\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(src)) return false;
  return !NON_READER_IMAGE_RE.test(`${src} ${alt} ${context}`);
}

function normalizeType(value) {
  const match = normalizeText(value).match(/\b(Manhua|Manhwa|Manga|Komik|Project)\b/i);
  if (!match) return "";
  const type = match[1].toLowerCase();
  if (type === "komik") return "Manga";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function parseRating(value) {
  const match = normalizeText(value).match(/(?:rating|score)\s*:?\s*([\d.]+)/i);
  return match?.[1] || "";
}

function parseChapterLabel(text, slug) {
  const value = normalizeText(`${text} ${slug}`);
  const match = value.match(/(?:chapter|ch\.?|episode|eps)\s*[-_:]?\s*([\d.]+)/i);
  if (match?.[1]) return safeSlug(match[1].replace(/\./g, "-"));
  const numericTail = String(slug || "").match(/(?:^|[-_/])(\d+(?:\.\d+)?)$/);
  return numericTail?.[1] ? safeSlug(numericTail[1].replace(/\./g, "-")) : "";
}

function cleanTitle(value) {
  return normalizeText(value)
    .replace(/^Baca\s+/i, "")
    .replace(/\s*[-|]\s*Komiktap.*$/i, "")
    .trim();
}

function logSourceFetch(context, url) {
  if (process.env.KOMIKTAP_DEBUG !== "1") return;
  console.log(`[komiktap:${context}] fetch ${url}`);
}

function logParseFailure(context, details = {}) {
  if (process.env.NODE_ENV === "production") return;
  console.error(`[komiktap:${context}] parse/fetch failed`, {
    sourceUrl: details.sourceUrl,
    status: details.status || details.statusCode || details.response?.status,
    message: details.message || details.error?.message,
    htmlPreview: normalizeText(details.html || "").slice(0, 1000),
  });
}

async function listFromUrl(url, type = "") {
  const $ = await fetchHTMLDocument(url);
  return parseListItems($, { type });
}

async function scrapeComicList(url, options = {}) {
  const page = positivePage(options.page);
  const expectedType = options.type || "";
  logSourceFetch("list", url);
  const $ = await fetchHTMLDocument(url);
  let results = parseListItems($, { type: expectedType });

  if (options.filterType) {
    const normalizedType = normalizeType(options.filterType);
    results = results.filter((item) => normalizeType(item.type) === normalizedType);
  }
  const hasNext = hasNextPage($, page, results.length);
  const limitedResults = results.slice(0, COMIC_LIST_PAGE_SIZE);

  return {
    currentPage: page,
    page,
    hasNextPage: hasNext,
    nextPageUrl: hasNext ? nextApiPageUrl(options.apiBasePath, page) : null,
    sourceUrl: url,
    results: limitedResults,
  };
}

async function getComicsByType(type, page = 1) {
  const normalizedType = safeSlug(type).toLowerCase();
  const category = CATEGORY_PATHS[normalizedType];
  if (!category) return null;

  const currentPage = positivePage(page);
  return {
    type: normalizedType,
    ...(await scrapeComicList(pagedSourceUrl(category.path, currentPage), {
      page: currentPage,
      type: category.type,
      filterType: category.type,
      apiBasePath: `/api/${normalizedType}`,
    })),
  };
}

async function getComicsByGenre(genreSlug, page = 1) {
  const slug = safeSlug(genreSlug);
  const currentPage = positivePage(page);

  return {
    slug,
    title: slug,
    ...(await scrapeComicList(pagedSourceUrl(`genres/${slug}`, currentPage), {
      page: currentPage,
      apiBasePath: `/api/genre/${slug}`,
    })),
  };
}

async function getAZList(page = 1) {
  const currentPage = positivePage(page);

  return scrapeComicList(pagedSourceUrl("a-z-list", currentPage), {
    page: currentPage,
    apiBasePath: "/api/populer",
  });
}

async function getLatestUpdates(page = 1) {
  const currentPage = positivePage(page);

  return scrapeComicList(latestUpdateSourceUrl(currentPage), {
    page: currentPage,
    apiBasePath: "/api/comics?type=latest",
  });
}

function pagedSourceUrl(path, page = 1) {
  const normalizedPath = String(path || "").replace(/^\/+|\/+$/g, "");
  return `${BASE_URL}/${normalizedPath}/page/${positivePage(page)}/`;
}

function latestUpdateSourceUrl(page = 1) {
  const currentPage = positivePage(page);
  return currentPage <= 1
    ? `${BASE_URL}/manga/?order=update`
    : `${BASE_URL}/manga/?page=${currentPage}&order=update`;
}

function requestPage(req) {
  return positivePage(req.query?.page || req.params?.page || 1);
}

function positivePage(value) {
  const parsed = parseInt(String(value || "1"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function hasNextPage($, currentPage, resultCount = 0) {
  const nextHref = $('a[rel="next"], a.next, .next a, .pagination a, .hpage a, .wp-pagenavi a')
    .toArray()
    .map((element) => ({
      href: absoluteUrl($(element).attr("href")),
      text: normalizeText($(element).text()),
    }))
    .find((item) => {
      const page = pageNumberFromUrl(item.href);
      return page > currentPage || /next|selanjutnya|berikut/i.test(item.text);
    });

  if (nextHref) return true;

  const pageNumbers = $("a[href*='/page/']")
    .toArray()
    .map((element) => pageNumberFromUrl($(element).attr("href")))
    .filter((page) => page > currentPage);

  return pageNumbers.length > 0 || resultCount >= COMIC_LIST_PAGE_SIZE;
}

function pageNumberFromUrl(url) {
  const match = String(url || "").match(/\/page\/(\d+)\/?/i);
  return match?.[1] ? parseInt(match[1], 10) || 0 : 0;
}

function nextApiPageUrl(apiBasePath, currentPage) {
  if (!apiBasePath) return null;
  const separator = apiBasePath.includes("?") ? "&" : "?";
  return `${apiBasePath}${separator}page=${currentPage + 1}`;
}

function notFound(res) {
  return res.status(404).json({ status: false, message: "Not Found" });
}

function fetchErrorMessage(error) {
  if (error?.statusCode === 503 || error?.response?.status === 403) {
    return "Komiktap source is protected or unavailable. Set KOMIKTAP_COOKIE with a valid browser cookie if needed, then restart the API server.";
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

async function detailFromCandidates(slug) {
  const normalizedSlug = safeSlug(slug);
  const candidates = [`${BASE_URL}/manga/${normalizedSlug}/`, `${BASE_URL}/komik/${normalizedSlug}/`];
  let lastError;

  for (const url of candidates) {
    try {
      logSourceFetch("detail", url);
      const $ = await fetchHTMLDocument(url);
      const html = $.html();
      const result = parseDetail($, normalizedSlug, url);
      if (result.title || result.chapters.length) return result;
      logParseFailure("detail", { sourceUrl: url, html, message: "empty title and chapters" });
    } catch (error) {
      lastError = error;
      logParseFailure("detail", { sourceUrl: url, error, message: error.message, response: error.response });
    }
  }

  if (lastError) throw lastError;
  return null;
}

async function settleList(promise) {
  try {
    return { results: await promise, error: null };
  } catch (error) {
    return { results: [], error: fetchErrorMessage(error) };
  }
}

async function getTypedList(req, res, type, candidates) {
  try {
    const currentPage = requestPage(req);
    const category = Object.entries(CATEGORY_PATHS).find(([, item]) => item.type === type);
    const data = category ? await getComicsByType(category[0], currentPage) : null;
    const results = data ? data.results : await listFromCandidates(candidates, type);

    if (!results.length) return notFound(res);
    res.json({
      status: true,
      source: "komiktap",
      type: category?.[0] || type.toLowerCase(),
      currentPage,
      page: currentPage,
      hasNextPage: data?.hasNextPage ?? false,
      nextPageUrl: data?.nextPageUrl ?? null,
      sourceUrl: data?.sourceUrl,
      results,
    });
  } catch (error) {
    sendFetchError(res, error);
  }
}

async function getComics(req, res) {
  try {
    const type = safeSlug(req.query.type || "").toLowerCase();
    const currentPage = requestPage(req);
    const data =
      type === "latest"
        ? await getLatestUpdates(currentPage)
        : CATEGORY_PATHS[type]
          ? await getComicsByType(type, currentPage)
          : await getAZList(currentPage);

    if (!data?.results.length) return notFound(res);

    res.json({
      status: true,
      source: "komiktap",
      type: type === "latest" || CATEGORY_PATHS[type] ? type : "a-z-list",
      ...data,
    });
  } catch (error) {
    sendFetchError(res, error, "Gagal mengambil list komik");
  }
}

async function getDoujin(req, res) {
  return getTypedList(req, res, "Project", [`${BASE_URL}/project/`, `${BASE_URL}/manga/`, `${BASE_URL}/list-manga/`]);
}

async function getManga(req, res) {
  return getTypedList(req, res, "Manga", [`${BASE_URL}/list-manga/`, `${BASE_URL}/manga/`]);
}

async function getManhwa(req, res) {
  return getTypedList(req, res, "Manhwa", [`${BASE_URL}/list-manhwa/`]);
}

async function getManhua(req, res) {
  return getTypedList(req, res, "Manhua", [`${BASE_URL}/list-manhua/`]);
}

async function getLibrary(req, res) {
  try {
    const [manga, manhwa, manhua] = await Promise.all([
      settleList(listFromCandidates([`${BASE_URL}/list-manga/`, `${BASE_URL}/manga/`], "Manga")),
      settleList(listFromCandidates([`${BASE_URL}/list-manhwa/`], "Manhwa")),
      settleList(listFromCandidates([`${BASE_URL}/list-manhua/`], "Manhua")),
    ]);
    const seen = new Set();
    const results = [...manga.results, ...manhwa.results, ...manhua.results].filter((item) => {
      if (!item.slug || seen.has(item.slug)) return false;
      seen.add(item.slug);
      return true;
    });
    if (!results.length && [manga, manhwa, manhua].some((item) => item.error)) {
      return res.status(503).json({
        status: false,
        message: [manga.error, manhwa.error, manhua.error].filter(Boolean)[0],
      });
    }
    res.json({
      status: true,
      source: "komiktap",
      results,
      errors: [manga.error, manhwa.error, manhua.error].filter(Boolean),
    });
  } catch (error) {
    sendFetchError(res, error);
  }
}

async function getHome(req, res) {
  try {
    const [latest, completed, manga, manhwa, manhua, genres] = await Promise.all([
      settleList(listFromCandidates([`${BASE_URL}/ongoing/`, `${BASE_URL}/`], "")),
      settleList(listFromCandidates([`${BASE_URL}/tamat/`], "")),
      settleList(listFromCandidates([`${BASE_URL}/list-manga/`, `${BASE_URL}/manga/`], "Manga")),
      settleList(listFromCandidates([`${BASE_URL}/list-manhwa/`], "Manhwa")),
      settleList(listFromCandidates([`${BASE_URL}/list-manhua/`], "Manhua")),
      settleList(getGenreItems()),
    ]);

    if (![latest, completed, manga, manhwa, manhua].some((item) => item.results.length)) {
      return res.status(503).json({
        status: false,
        message: [latest.error, completed.error, manga.error, manhwa.error, manhua.error].filter(Boolean)[0],
      });
    }

    res.json({
      status: true,
      source: "komiktap",
      latest: latest.results,
      popular: completed.results,
      recommended: [...manga.results, ...manhwa.results, ...manhua.results],
      manga: manga.results,
      manhwa: manhwa.results,
      manhua: manhua.results,
      genres: genres.results,
      errors: [latest.error, completed.error, manga.error, manhwa.error, manhua.error, genres.error].filter(Boolean),
    });
  } catch (error) {
    sendFetchError(res, error);
  }
}

async function getGenreItems() {
  const $ = await fetchHTMLDocument(`${BASE_URL}/genres/`);
  const seen = new Set();
  return $('a[href*="/genre/"], a[href*="/genres/"]')
    .toArray()
    .map((element) => ({
      name: normalizeText($(element).text()),
      slug: extractLastSlug($(element).attr("href")),
      url: absoluteUrl($(element).attr("href")),
    }))
    .filter((item) => {
      if (!item.name || !item.slug || RESERVED_SEGMENTS.has(item.slug) || seen.has(item.slug)) return false;
      seen.add(item.slug);
      return true;
    });
}

async function getGenres(req, res) {
  try {
    const results = await getGenreItems();
    if (!results.length) return notFound(res);
    res.json({ status: true, source: "komiktap", results });
  } catch (error) {
    sendFetchError(res, error, "Gagal mengambil genre");
  }
}

async function getGenreDetail(req, res) {
  try {
    const slug = safeSlug(req.params.slug);
    const currentPage = requestPage(req);
    const data = await getComicsByGenre(slug, currentPage);
    const results = data.results;

    if (!results.length) return notFound(res);
    res.json({
      status: true,
      source: "komiktap",
      slug,
      title: slug,
      currentPage,
      page: currentPage,
      hasNextPage: data.hasNextPage,
      nextPageUrl: data.nextPageUrl,
      sourceUrl: data.sourceUrl,
      results,
    });
  } catch (error) {
    sendFetchError(res, error, "Gagal mengambil genre");
  }
}

async function getDetail(req, res) {
  try {
    const slug = safeSlug(req.params.slug);
    const result = await detailFromCandidates(slug);
    if (!result?.title || !result?.slug) return notFound(res);
    res.json({ status: true, source: "komiktap", result });
  } catch (error) {
    sendFetchError(res, error, "Gagal mengambil detail");
  }
}

async function getChapter(req, res) {
  try {
    const mangaSlug = safeSlug(req.params.slug);
    const chapterNumber = safeSlug(req.params.chapter);
    const chapterSlug = chapterNumber ? buildChapterSlug(mangaSlug, chapterNumber) : mangaSlug;
    const candidates = [`${BASE_URL}/${chapterSlug}/`];
    let result = null;
    let lastError;

    for (const url of candidates) {
      try {
        logSourceFetch("chapter", url);
        const $ = await fetchHTMLDocument(url, {
          ttl: CHAPTER_TTL,
          requireReaderImages: true,
        });
        const html = $.html();
        result = await parseChapter($, chapterSlug, url);
        if (result.images.length) break;
        logParseFailure("chapter", { sourceUrl: url, html, message: "empty images" });
      } catch (error) {
        lastError = error;
        logParseFailure("chapter", { sourceUrl: url, error, message: error.message, response: error.response });
      }
    }

    if (!result?.images.length) {
      if (lastError) throw lastError;
      return notFound(res);
    }

    res.json({ status: true, source: "komiktap", result });
  } catch (error) {
    sendFetchError(res, error, "Gagal mengambil chapter");
  }
}

async function getSearch(req, res) {
  try {
    const query = normalizeText(req.query.q || "");
    if (!query) return res.json({ status: true, source: "komiktap", query, results: [] });

    const $ = await fetchHTMLDocument(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
    const results = parseListItems($);
    res.json({ status: true, source: "komiktap", query, results });
  } catch (error) {
    sendFetchError(res, error, "Gagal mencari data");
  }
}

async function getPopular(req, res) {
  try {
    const currentPage = requestPage(req);
    const data = await getAZList(currentPage);
    if (!data.results.length) return notFound(res);

    res.json({
      status: true,
      source: "komiktap",
      type: "a-z-list",
      ...data,
    });
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
  scrapeComicList,
  getComicsByType,
  getComicsByGenre,
  getAZList,
  getLatestUpdates,
  getComics,
  getDoujin,
  getManga,
  getManhwa,
  getManhua,
  getLibrary,
  getHome,
  getGenres,
  getGenreDetail,
  getDetail,
  getChapter,
  getSearch,
  getPopular,
};
