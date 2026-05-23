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

async function getFragmentHtml(pageUrl, selectorContext) {
  const shellHtml = await fetchHtml(pageUrl);
  if (!shellHtml) {
    logEmptyParse(selectorContext, shellHtml, { target: pageUrl });
  }
  return shellHtml;
}

function formatMangaCard($, el) {
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
  const url = getAbsoluteUrl(mangaLinkElement.attr("href"));
  const slug = extractMangaSlug(url);
  const img = card.find('a[href*="/manga/"] img, img').first();
  const type = parseTypeFromText(card.text());
  const typeGenreText = normalizeText(card.find(".tpe1_inf").first().text());
  const chapterLinks = card
    .find("a[href]")
    .filter((_, link) => isChapterUrl($(link).attr("href")))
    .toArray();
  const firstChapterElement = chapterLinks.length ? $(chapterLinks[0]) : null;
  const latestChapterElement = chapterLinks.length
    ? $(chapterLinks[chapterLinks.length - 1])
    : null;

  return {
    title:
      cleanTitle(card.find("h3, h2, h4").first().text()) ||
      cleanTitle(mangaLinkElement.attr("title")) ||
      cleanTitle(img.attr("alt")),
    thumbnail: getImageUrl($, img),
    type,
    genre: typeGenreText.replace(type, "").trim(),
    url,
    detailUrl: slug ? `/detail-komik/${slug}` : null,
    description: normalizeText(card.find("p").first().text()),
    stats: normalizeText(card.find(".judul2").first().text()),
    firstChapter: firstChapterElement
      ? {
          title:
            normalizeText(firstChapterElement.attr("title")) ||
            normalizeText(firstChapterElement.text()),
          url: getApiChapterLink(
            firstChapterElement.attr("href"),
            "",
            firstChapterElement.text()
          ),
        }
      : null,
    latestChapter: latestChapterElement
      ? {
          title:
            normalizeText(latestChapterElement.attr("title")) ||
            normalizeText(latestChapterElement.text()),
          url: getApiChapterLink(
            latestChapterElement.attr("href"),
            "",
            latestChapterElement.text()
          ),
        }
      : null,
  };
}

function parseMangaList(html, context) {
  const $ = cheerio.load(html);
  const elements = $(
    '.entry, .bs, .bsx, .utao, .listupd article, .entries article, .post, article:has(a[href*="/manga/"]), li:has(a[href*="/manga/"]), div:has(a[href*="/manga/"]):has(img)'
  ).toArray();
  const seen = new Set();
  const results = elements
    .map((el) => formatMangaCard($, el))
    .filter((item) => {
      const slug = extractMangaSlug(item.url);
      if (!item.title || !item.url || seen.has(slug)) return false;
      seen.add(slug);
      return true;
    });

  if (!results.length) {
    logEmptyParse(context, html, {
      selector: '.bge/article + a[href*="/manga/"]',
    });
  }

  return results;
}

async function scrapeMangaData(page = 1) {
  const validPage = Math.max(1, parseInt(page, 10) || 1);
  const pageUrl =
    validPage === 1 ? `${BASE_URL}/manga/` : `${BASE_URL}/manga/page/${validPage}/`;
  const html = await getFragmentHtml(pageUrl, `GET /pustaka/page/${validPage}`);

  return {
    page: validPage,
    results: parseMangaList(html, `GET /pustaka/page/${validPage}`),
  };
}

const getPustaka = {
  getPustakapage: async (req, res) => {
    try {
      const data = await scrapeMangaData(1);
      res.json(data);
    } catch (error) {
      console.error("Error GET /pustaka:", error);
      res.status(500).json({ error: "Failed to fetch manga data" });
    }
  },

  getPustakaPagination: async (req, res) => {
    try {
      const page = parseInt(req.params.page, 10) || 1;
      const data = await scrapeMangaData(page);
      res.json(data);
    } catch (error) {
      console.error("Error GET /pustaka/page:", error);
      res.status(500).json({ error: "Failed to fetch manga data" });
    }
  },
};

module.exports = getPustaka;
