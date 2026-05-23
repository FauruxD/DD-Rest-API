const cheerio = require("cheerio");
const {
  BASE_URL,
  fetchHtml,
  getAbsoluteUrl,
  normalizeText,
  cleanTitle,
  getImageUrl,
  extractMangaSlug,
  isMangaDetailUrl,
  parseTypeFromText,
  logEmptyParse,
} = require("./scraperUtils");

const getSearch = async (req, res) => {
  const keyword = req.query.q;
  if (!keyword)
    return res.status(400).json({ error: "Parameter q wajib diisi" });

  const searchUrl = `${BASE_URL}/manga/?title=${encodeURIComponent(keyword)}`;

  try {
    const html = await fetchHtml(searchUrl);
    const $ = cheerio.load(html);
    let hasil = parseResults($);

    if (!hasil.length) {
      const fallbackUrl = `${BASE_URL}/?s=${encodeURIComponent(keyword)}`;
      const fallbackHtml = await fetchHtml(fallbackUrl);
      hasil = parseResults(cheerio.load(fallbackHtml));

      if (!hasil.length) {
        logEmptyParse("GET /search", fallbackHtml, {
          target: fallbackUrl,
          selector: 'a[href*="/manga/"], img, h3',
        });
      }
    }

    res.json({
      status: true,
      message:
        hasil.length > 0
          ? "Berhasil mendapatkan hasil pencarian"
          : "Tidak ada hasil pencarian ditemukan",
      keyword,
      url: searchUrl,
      total: hasil.length,
      data: hasil,
    });
  } catch (err) {
    console.error("Error GET /search:", err);
    res.status(500).json({
      status: false,
      message: "Gagal mengambil data",
      error: err.message,
    });
  }
};

function getCardElements($) {
  const selectors = [
    '.entry, .bs, .bsx, .utao, .listupd article, .entries article, .post',
    'article:has(a[href*="/manga/"])',
    'li:has(a[href*="/manga/"])',
    'div:has(> a[href*="/manga/"]):has(img)',
  ];

  for (const selector of selectors) {
    const elements = $(selector).toArray();
    if (elements.length) return elements;
  }

  return $('a[href*="/manga/"]')
    .toArray()
    .map((link) => $(link).closest("article, li, div").get(0))
    .filter(Boolean);
}

function parseResults($) {
  const hasil = [];
  const seen = new Set();

  getCardElements($).forEach((el) => {
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
    const slug = extractMangaSlug(mangaLink);
    if (!slug || seen.has(slug)) return;

    const img = card.find('a[href*="/manga/"] img, img').first();
    const type = parseTypeFromText(card.text());
    const typeGenreText = normalizeText(card.find(".tpe1_inf").first().text());
    const title =
      cleanTitle(card.find("h3, h2, h4").first().text()) ||
      cleanTitle(mangaLinkElement.attr("title")) ||
      cleanTitle(img.attr("alt"));

    if (!title) return;
    seen.add(slug);

    hasil.push({
      title,
      altTitle: normalizeText(card.find(".judul2").first().text()) || null,
      slug,
      href: `/detail-komik/${slug}/`,
      thumbnail: getImageUrl($, img) || "",
      type,
      genre: typeGenreText.replace(type, "").trim() || null,
      description: normalizeText(card.find("p").first().text()),
    });
  });

  return hasil;
}

module.exports = { getSearch };
