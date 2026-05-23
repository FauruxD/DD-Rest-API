const cheerio = require("cheerio");
const {
  BASE_URL,
  fetchHtml,
  getAbsoluteUrl,
  normalizeText,
  cleanTitle,
  getImageUrl,
  extractMangaSlug,
  extractChapterNumber,
  getApiChapterLink,
  isMangaDetailUrl,
  isChapterUrl,
  logEmptyParse,
} = require("./scraperUtils");

function parseType(...values) {
  const text = values.map(normalizeText).join(" ");
  const match = text.match(/\b(Doujinshi|Manga|Manhwa)\b/i);
  if (!match) return "";
  const type = match[1].toLowerCase();
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function parseKomikCard($, el) {
  const card = $(el);
  const mangaLinkElement =
    card
      .find('a[href*="/manga/"]')
      .filter((_, link) => isMangaDetailUrl($(link).attr("href")))
      .filter((_, link) => normalizeText($(link).text()))
      .first().length
      ? card
          .find('a[href*="/manga/"]')
          .filter((_, link) => isMangaDetailUrl($(link).attr("href")))
          .filter((_, link) => normalizeText($(link).text()))
          .first()
      : card
          .find('a[href*="/manga/"]')
          .filter((_, link) => isMangaDetailUrl($(link).attr("href")))
          .first();
  const originalLink = getAbsoluteUrl(mangaLinkElement.attr("href"));
  const mangaSlug = extractMangaSlug(originalLink);
  const img = card.find('a[href*="/manga/"] img, img').first();
  const infoText = normalizeText(
    card.find("span, p, small").filter((_, node) => /views?|pembaca|·/i.test($(node).text())).first().text()
  );
  const infoParts = infoText.split(/\s*[·|]\s*/).map(normalizeText).filter(Boolean);
  const genre = infoParts.find((part) => !/views?|pembaca/i.test(part)) || "";
  const readers = infoParts.find((part) => /views?|pembaca/i.test(part)) || "";
  const latestChapterElement = card
    .find("a[href]")
    .filter((_, link) => isChapterUrl($(link).attr("href")))
    .last();
  const originalChapterLink = getAbsoluteUrl(latestChapterElement.attr("href"));
  const latestChapter =
    normalizeText(latestChapterElement.text()) ||
    normalizeText(latestChapterElement.attr("title"));
  const chapterNumber =
    extractChapterNumber(originalChapterLink) ||
    latestChapter.match(/Chapter\s*([\d.]+)/i)?.[1] ||
    "";

  return {
    title:
      cleanTitle(card.find(".metadata h3, h3.title, h3, h2, h4").first().text()) ||
      cleanTitle(mangaLinkElement.attr("title")) ||
      cleanTitle(mangaLinkElement.text()) ||
      cleanTitle(img.attr("alt")),
    originalLink,
    apiDetailLink: mangaSlug ? `/detail-komik/${mangaSlug}` : null,
    thumbnail: getImageUrl($, img),
    genre,
    readers,
    latestChapter,
    originalChapterLink,
    apiChapterLink: getApiChapterLink(originalChapterLink, mangaSlug, latestChapter),
    mangaSlug,
    chapterNumber,
    type: parseType(mangaLinkElement.attr("title"), img.attr("alt"), card.text()),
  };
}

function scrapeKomikSection($, sectionSelector, fallbackTitle, typeFilter = "") {
  const sectionElement = $(sectionSelector).length
    ? $(sectionSelector)
    : $("main, body, section")
        .filter((_, el) => /Komik Populer|Populer Update|Peringkat/i.test($(el).text()))
        .first();
  const root = sectionElement.length ? sectionElement : $("body");
  const title =
    normalizeText(sectionElement.find("h1,h2,h3").first().text()) ||
    fallbackTitle;
  const seen = new Set();
  const cardElements = root.find(
    '.entry, .bs, .bsx, .utao, .listupd article, .entries article, .post, article:has(a[href*="/manga/"]), li:has(a[href*="/manga/"]), div:has(a[href*="/manga/"]):has(img)'
  );
  const items = cardElements
    .toArray()
    .map((el) => parseKomikCard($, el))
    .filter((item) => {
      if (
        !item.title ||
        !item.originalLink ||
        !item.thumbnail ||
        seen.has(item.mangaSlug)
      ) {
        return false;
      }

      if (typeFilter && item.type !== typeFilter) return false;
      seen.add(item.mangaSlug);
      return true;
    })
    .map(({ type, ...item }) => item);

  return { title: fallbackTitle || title, items };
}

async function loadPopularPage(type = "") {
  const typeQuery = type ? `&type=${encodeURIComponent(type)}` : "";
  const data = await fetchHtml(`${BASE_URL}/manga/?order=popular${typeQuery}`);
  return { data, $: cheerio.load(data) };
}

function ensureItems(context, data, result) {
  if (!result.items.length) {
    logEmptyParse(context, data, {
      target: BASE_URL,
      selector: '#Komik_Populer a[href*="/manga/"], a[href*="chapter"], img',
    });
  }
}

const komikPopuler = async (req, res) => {
  try {
    const mangaPage = await loadPopularPage("Manga");
    const manhwaPage = await loadPopularPage("Manhwa");
    const doujinshiPage = await loadPopularPage("Doujinshi");
    const mangaPopuler = scrapeKomikSection(mangaPage.$, "body", "Manga Populer", "Manga");
    const manhwaPopuler = scrapeKomikSection(manhwaPage.$, "body", "Manhwa Populer", "Manhwa");
    const doujinshiPopuler = scrapeKomikSection(
      doujinshiPage.$,
      "body",
      "Doujinshi Populer",
      "Doujinshi"
    );

    ensureItems("GET /komik-populer manga", mangaPage.data, mangaPopuler);

    res.json({
      manga: mangaPopuler,
      manhwa: manhwaPopuler,
      doujinshi: doujinshiPopuler,
    });
  } catch (err) {
    console.error("Error scraping semua komik populer:", err);
    res.status(500).json({
      error: "Gagal mengambil data komik populer",
      detail: err.message,
    });
  }
};

const rekomendasiManga = async (req, res) => {
  try {
    const { data, $ } = await loadPopularPage("Manga");
    const mangaPopuler = scrapeKomikSection($, "body", "Manga Populer", "Manga");
    ensureItems("GET /komik-populer/manga", data, mangaPopuler);
    res.json(mangaPopuler);
  } catch (err) {
    console.error("Error scraping manga populer:", err);
    res.status(500).json({
      error: "Gagal mengambil data manga populer",
      detail: err.message,
    });
  }
};

const rekomendasiManhwa = async (req, res) => {
  try {
    const { data, $ } = await loadPopularPage("Manhwa");
    const manhwaPopuler = scrapeKomikSection($, "body", "Manhwa Populer", "Manhwa");
    ensureItems("GET /komik-populer/manhwa", data, manhwaPopuler);
    res.json(manhwaPopuler);
  } catch (err) {
    console.error("Error scraping manhwa populer:", err);
    res.status(500).json({
      error: "Gagal mengambil data manhwa populer",
      detail: err.message,
    });
  }
};

const rekomendasiDoujinshi = async (req, res) => {
  try {
    const { data, $ } = await loadPopularPage("Doujinshi");
    const doujinshiPopuler = scrapeKomikSection(
      $,
      "body",
      "Doujinshi Populer",
      "Doujinshi"
    );
    ensureItems("GET /komik-populer/doujinshi", data, doujinshiPopuler);
    res.json(doujinshiPopuler);
  } catch (err) {
    console.error("Error scraping doujinshi populer:", err);
    res.status(500).json({
      error: "Gagal mengambil data doujinshi populer",
      detail: err.message,
    });
  }
};

module.exports = {
  komikPopuler,
  rekomendasiManga,
  rekomendasiManhwa,
  rekomendasiDoujinshi,
};
