const cheerio = require("cheerio");
const {
  BASE_URL,
  fetchHtml,
  getAbsoluteUrl,
  normalizeText,
  cleanTitle,
  getImageUrl,
  extractMangaSlug,
  getApiChapterLink,
  isMangaDetailUrl,
  isChapterUrl,
  parseTypeFromText,
  logEmptyParse,
} = require("./scraperUtils");

function parseMangaCard($, el) {
  const card = $(el);
  const mangaLinkElement =
    card
      .find('a[href*="/manga/"]')
      .filter((_, link) => isMangaDetailUrl($(link).attr("href")))
      .filter((_, link) => normalizeText($(link).text()))
      .first()
      .length
      ? card
          .find('a[href*="/manga/"]')
          .filter((_, link) => isMangaDetailUrl($(link).attr("href")))
          .filter((_, link) => normalizeText($(link).text()))
          .first()
      : card
          .find('a[href*="/manga/"]')
          .filter((_, link) => isMangaDetailUrl($(link).attr("href")))
          .first();
  const mangaLink = getAbsoluteUrl(mangaLinkElement.attr("href"));
  const mangaSlug = extractMangaSlug(mangaLink);
  const img = card.find('a[href*="/manga/"] img, img').first();
  const type = parseTypeFromText(card.text());
  const typeGenreText = normalizeText(card.find(".tpe1_inf").first().text());
  const chapterElements = card
    .find("a[href]")
    .filter((_, link) => isChapterUrl($(link).attr("href")))
    .toArray();
  const firstChapterElement = chapterElements.length ? $(chapterElements[0]) : null;
  const latestChapterElement = chapterElements.length
    ? $(chapterElements[chapterElements.length - 1])
    : null;

  return {
    title:
      cleanTitle(card.find("h3, h2, h4").first().text()) ||
      cleanTitle(mangaLinkElement.attr("title")) ||
      cleanTitle(img.attr("alt")),
    slug: mangaSlug,
    type,
    genre: typeGenreText.replace(type, "").trim(),
    thumbnail: getImageUrl($, img),
    description: normalizeText(card.find("p").first().text()),
    additionalInfo: normalizeText(card.find(".judul2").first().text()),
    updateStatus: normalizeText(card.find(".up").first().text()),
    apiMangaLink: mangaSlug ? `/detail-komik/${mangaSlug}` : null,
    chapters: {
      first: firstChapterElement
        ? {
            chapter: normalizeText(firstChapterElement.text()) ||
              normalizeText(firstChapterElement.attr("title")),
            link: getAbsoluteUrl(firstChapterElement.attr("href")),
            apiLink: getApiChapterLink(
              firstChapterElement.attr("href"),
              "",
              firstChapterElement.text()
            ),
          }
        : null,
      latest: latestChapterElement
        ? {
            chapter: normalizeText(latestChapterElement.text()) ||
              normalizeText(latestChapterElement.attr("title")),
            link: getAbsoluteUrl(latestChapterElement.attr("href")),
            apiLink: getApiChapterLink(
              latestChapterElement.attr("href"),
              "",
              latestChapterElement.text()
            ),
          }
        : null,
    },
  };
}

async function loadGenreHtml(slug, pageNum) {
  const pagePath = pageNum > 1 ? `/genre/${slug}/page/${pageNum}/` : `/genre/${slug}/`;
  const targetUrl = `${BASE_URL}${pagePath}`;
  const shellHtml = await fetchHtml(targetUrl);
  return { html: shellHtml, targetUrl, htmxUrl: null };
}

async function handleGenreRequest(req, res) {
  try {
    const { slug, page = 1 } = req.params;
    const pageNum = parseInt(page, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        error: "Invalid page number",
        message: "Page must be a positive integer",
      });
    }

    const { html, targetUrl, htmxUrl } = await loadGenreHtml(slug, pageNum);
    const $ = cheerio.load(html);
    const mangaElements = $(
      '.entry, .bs, .bsx, .utao, .listupd article, .entries article, .post, article:has(a[href*="/manga/"]), li:has(a[href*="/manga/"]), div:has(a[href*="/manga/"]):has(img)'
    );
    const seen = new Set();
    const mangaList = mangaElements
      .toArray()
      .map((el) => parseMangaCard($, el))
      .filter((item) => {
        if (!item.title || !item.thumbnail || !item.slug || seen.has(item.slug)) {
          return false;
        }
        seen.add(item.slug);
        return true;
      });

    const nextPageMatch = $("a[href]")
      .toArray()
      .map((link) => $(link).attr("href")?.match(/page\/(\d+)/)?.[1])
      .filter(Boolean)
      .map((value) => parseInt(value, 10))
      .filter((value) => value > pageNum)
      .sort((a, b) => a - b)[0];
    const hasNextPage = Boolean(nextPageMatch) || mangaList.length >= 10;
    const nextPageUrl = nextPageMatch
      ? `/genre/${slug}/page/${nextPageMatch}`
      : mangaList.length >= 10
      ? `/genre/${slug}/page/${pageNum + 1}`
      : null;

    if (!mangaList.length) {
      logEmptyParse("GET /genre", html, {
        target: htmxUrl || targetUrl,
        selector: '.bge/article + a[href*="/manga/"]',
      });

      return res.status(404).json({
        success: false,
        error: "No manga found",
        message: `No manga found for genre "${slug}" on page ${pageNum}`,
        genre: slug,
        currentPage: pageNum,
        debug: {
          targetUrl,
          htmxUrl,
          elementsFound: mangaElements.length,
        },
      });
    }

    res.json({
      success: true,
      genre: slug,
      currentPage: pageNum,
      totalManga: mangaList.length,
      hasNextPage,
      nextPageUrl,
      data: mangaList,
      debug: {
        targetUrl,
        htmxUrl,
        elementsFound: mangaElements.length,
        pageTitle: $("title").text().trim(),
      },
    });
  } catch (err) {
    console.error(
      `Error on GET /genre/${req.params.slug}/${req.params.page || 1}:`,
      err.message
    );

    res.status(500).json({
      success: false,
      error: "Failed to fetch manga data",
      message: "Internal server error while fetching manga from genre",
      detail: err.message,
      genre: req.params.slug,
      page: parseInt(req.params.page, 10) || 1,
    });
  }
}

module.exports = { handleGenreRequest };
