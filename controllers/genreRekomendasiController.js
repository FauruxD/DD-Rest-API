// File: routes/genre.js
const cheerio = require("cheerio");
const {
  BASE_URL,
  fetchHtml,
  getAbsoluteUrl,
  normalizeText,
  logEmptyParse,
} = require("./scraperUtils");

const genreRekomendasi = async (req, res) => {
  try {
    const data = await fetchHtml(`${BASE_URL}/genre/`);

    const $ = cheerio.load(data);
    const genreRekomendasi = [];
    const seen = new Set();

    $('a[href*="/genre/"]').each((i, el) => {
      const anchorTag = $(el);
      const title = normalizeText(anchorTag.text()).replace(/\s*\(\d+\)\s*$/, "");
      const originalLinkPath = anchorTag.attr("href");
      const genreSlug = String(originalLinkPath || "").match(/\/genre\/([^/]+)/)?.[1] || "";
      const finalOriginalLink = getAbsoluteUrl(originalLinkPath);

      if (title && genreSlug && !seen.has(genreSlug)) {
        seen.add(genreSlug);
        genreRekomendasi.push({
          title,
          slug: genreSlug,
          originalLink: finalOriginalLink,
          readLink: finalOriginalLink,
          apiGenreLink: `/genre/${genreSlug}`,
          thumbnail: null,
        });
      }
    });

    if (!genreRekomendasi.length) {
      logEmptyParse("GET /genre-rekomendasi", data, {
        target: `${BASE_URL}/genre/`,
        selector: '.ls3, a[href*="/genre/"], img',
      });
    }

    res.json(genreRekomendasi);
  } catch (err) {
    console.error("Kesalahan pada GET /genre:", err.message);
    res.status(500).json({
      error: "Gagal mengambil genre rekomendasi dari server.",
      detail: err.message,
    });
  }
};

module.exports = { genreRekomendasi };
