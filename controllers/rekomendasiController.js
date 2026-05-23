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
  logEmptyParse,
} = require("./scraperUtils");

const getRekomendasi = async (req, res) => {
  try {
    const targetUrl = `${BASE_URL}/manga/?order=popular`;
    const data = await fetchHtml(targetUrl);
    const $ = cheerio.load(data);
    const section =
      $("#Rekomendasi_Komik").length > 0
        ? $("#Rekomendasi_Komik")
        : $("main, body, section")
            .filter((_, el) => /Peringkat|Rekomendasi/i.test($(el).text()))
            .first();
    const root = section.length ? section : $("body");
    const rekomendasi = [];
    const seen = new Set();

    root
      .find('.entry, .bs, .bsx, .utao, .post, article, li, div:has(a[href*="/manga/"])')
      .toArray()
      .forEach((el) => {
        const card = $(el);
        const anchorTag =
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
        const originalLink = getAbsoluteUrl(anchorTag.attr("href"));
        const slug = extractMangaSlug(originalLink);
        if (!slug || seen.has(slug)) return;

        const imgTag = card.find('a[href*="/manga/"] img, img').first();
        const title =
          cleanTitle(card.find(".metadata h3, h3.title, h3, h2, h4").first().text()) ||
          cleanTitle(anchorTag.attr("title")) ||
          cleanTitle(anchorTag.text()) ||
          cleanTitle(imgTag.attr("alt"));
        const thumbnail = getImageUrl($, imgTag);

        if (title && thumbnail && originalLink) {
          seen.add(slug);
          rekomendasi.push({
            title,
            originalLink,
            apiDetailLink: `/detail-komik/${slug}`,
            thumbnail,
          });
        }
      });

    if (!rekomendasi.length) {
      logEmptyParse("GET /rekomendasi", data, {
        target: targetUrl,
        selector: '#Rekomendasi_Komik a[href*="/manga/"], img',
      });
    }

    res.json(rekomendasi);
  } catch (err) {
    console.error("Kesalahan pada GET /rekomendasi:", err.message);
    res.status(500).json({
      error: "Gagal mengambil komik rekomendasi dari server.",
      detail: err.message,
    });
  }
};

module.exports = { getRekomendasi };
