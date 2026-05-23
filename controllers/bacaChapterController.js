const cheerio = require("cheerio");
const {
  BASE_URL,
  fetchHtml,
  getAbsoluteUrl,
  normalizeText,
  getImageUrl,
  extractMangaSlug,
  extractChapterNumber,
  extractChapterSlug,
  isChapterUrl,
  isLikelyAdImage,
  logEmptyParse,
} = require("./scraperUtils");

function extractSlugAndChapter(url) {
  const absoluteUrl = getAbsoluteUrl(url);
  return {
    slug: extractChapterSlug(absoluteUrl),
    chapter: extractChapterNumber(absoluteUrl),
  };
}

function getChapterInfo(link, currentSlug = "") {
  if (!link) return null;

  const originalLink = getAbsoluteUrl(link);
  const slug = extractChapterSlug(originalLink) || currentSlug;
  const chapter = extractChapterNumber(originalLink);

  return slug && chapter
    ? {
        originalLink,
        apiLink: `/baca-chapter/${slug}/${chapter}`,
        slug,
        chapter,
      }
    : null;
}

function getDescription($) {
  const descriptionText = normalizeText($("#Description").first().text());
  if (descriptionText) return descriptionText;

  return normalizeText(
    $("p")
      .filter((_, el) => /Selamat membaca|update di Doujindesu|Daftar koleksi manga/i.test($(el).text()))
      .first()
      .text()
  );
}

function collectReaderImages($) {
  const images = [];

  $(
    "#anu img, #reader .main img, #Baca_Komik img, .readerarea img, .entry-content img, img.ww, img[id]"
  ).each((_, el) => {
    const img = $(el);
    if (img.closest(".blox, .adv-wrapper, footer, header, nav").length) return;

    const src = getImageUrl($, img);
    const id = normalizeText(img.attr("id"));
    const alt = normalizeText(img.attr("alt"));

    if (
      src &&
      !/logo-doujindesu|favicon|histats/i.test(src) &&
      !isLikelyAdImage(src, alt) &&
      (!id || /^\d+$/.test(id) || /page|image|img/i.test(id))
    ) {
      images.push({
        src,
        alt,
        id,
        fallbackSrc: src,
      });
    }
  });

  return images;
}

const getBacaChapter = async (req, res) => {
  try {
    const { slug, chapter } = req.params;
    const chapterUrl = `${BASE_URL}/${slug}/`;
    const data = await fetchHtml(chapterUrl);
    const $ = cheerio.load(data);

    const title =
      normalizeText($("#Judul h1").first().text()) ||
      normalizeText($("#reader h1").first().text()) ||
      normalizeText($("h1").filter((_, el) => normalizeText($(el).text())).first().text()) ||
      normalizeText($("meta[itemprop='name']").attr("content")).replace(/\s*-\s*Doujindesu\..*$/i, "");
    const mangaTitleElement =
      $("#reader .epx a[href*='/manga/']").first().length
        ? $("#reader .epx a[href*='/manga/']").first()
        : $('#Judul a[href*="/manga/"], a[href*="/manga/"]')
            .filter((_, el) => normalizeText($(el).attr("title")) || normalizeText($(el).text()))
            .first();
    const mangaTitle =
      normalizeText(mangaTitleElement.find("b").first().text()) ||
      normalizeText(mangaTitleElement.text()) ||
      normalizeText(mangaTitleElement.attr("title"));
    const mangaLink = getAbsoluteUrl(mangaTitleElement.attr("href"));
    const mangaSlug = extractMangaSlug(mangaLink);

    const chapterInfo = {};
    $("#Judul table tr, table.tbl tr").each((_, el) => {
      const cells = $(el).find("td, th");
      const key = normalizeText(cells.first().text()).replace(/:$/, "");
      const value = normalizeText(cells.last().text());
      if (key && value && key !== value) chapterInfo[key] = value;
    });

    const images = collectReaderImages($);
    const readerId = $("#reader").attr("data-id");
    const totalReaderPages = $("#reader").attr("data-total-pages");

    if (!images.length && readerId) {
      try {
        const readerHtml = await fetchHtml(`${BASE_URL}/themes/ajax/ch.php`, {
          method: "POST",
          data: { id: readerId },
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": BASE_URL,
            "Referer": chapterUrl,
            "X-Requested-With": "XMLHttpRequest",
          },
          timeout: 25000,
        });
        const $reader = cheerio.load(`<div id="anu">${readerHtml}</div>`);
        images.push(...collectReaderImages($reader));
      } catch (readerError) {
        console.error("Gagal mengambil AJAX reader Doujindesu:", readerError.message);
      }
    }

    const uniqueImages = images.filter(
      (image, index, allImages) =>
        image.src && allImages.findIndex((item) => item.src === image.src) === index
    );

    const navigationLinks = $("#Judul")
      .parent()
      .find("a[href]")
      .toArray()
      .map((el) => getAbsoluteUrl($(el).attr("href")))
      .filter((link) => link && isChapterUrl(link));

    const currentChapterNumber = parseFloat(extractChapterNumber(chapterUrl, title) || chapter);
    const chapterCandidates = [
      ...new Set(
        navigationLinks.filter(
          (link) =>
            extractChapterSlug(link) !== slug &&
            extractChapterNumber(link, title) !== String(chapter)
        )
      ),
    ];

    const prevLink =
      chapterCandidates
        .filter((link) => parseFloat(extractChapterNumber(link, title)) < currentChapterNumber)
        .sort(
          (a, b) =>
            parseFloat(extractChapterNumber(b, title)) -
            parseFloat(extractChapterNumber(a, title))
        )[0] || "";
    const nextLink =
      chapterCandidates
        .filter((link) => parseFloat(extractChapterNumber(link, title)) > currentChapterNumber)
        .sort(
          (a, b) =>
            parseFloat(extractChapterNumber(a, title)) -
            parseFloat(extractChapterNumber(b, title))
        )[0] || "";

    const chapterValueInfo =
      $(".chapterInfo").attr("valuechapter") ||
      extractChapterNumber(chapterUrl, title) ||
      chapter;
    const totalImages =
      $(".chapterInfo").attr("valuegambar") ||
      totalReaderPages ||
      uniqueImages.length.toString();
    const viewAnalyticsUrl = $(".chapterInfo").attr("valueview") || "";
    const additionalDescription = normalizeText($("#Komentar p").first().text());
    const publishDate =
      $("time[property='datePublished']").attr("datetime") ||
      $("meta[itemprop='datePublished']").attr("content") ||
      normalizeText($("time").first().text());

    if (!title || !uniqueImages.length) {
      logEmptyParse("GET /baca-chapter", data, {
        target: chapterUrl,
        titleFound: !!title,
        imagesFound: uniqueImages.length,
        selectors: "h1, .entry-content img, article img",
      });

      return res.status(502).json({
        error: "Gagal parsing data chapter komik dari Doujindesu.",
        detail: readerId
          ? "Gambar chapter dimuat lewat AJAX Doujindesu dan request reader ditolak/kosong dari server."
          : "Struktur HTML chapter kemungkinan berubah atau gambar chapter kosong.",
      });
    }

    res.json({
      title,
      mangaInfo: {
        title: mangaTitle,
        originalLink: mangaLink,
        apiLink: mangaSlug ? `/detail-komik/${mangaSlug}` : null,
        slug: mangaSlug,
      },
      description: getDescription($),
      chapterInfo,
      images: uniqueImages,
      meta: {
        chapterNumber: chapterValueInfo,
        totalImages: parseInt(totalImages, 10) || 0,
        publishDate,
        viewAnalyticsUrl,
        slug,
      },
      navigation: {
        prevChapter: getChapterInfo(prevLink, slug),
        nextChapter: getChapterInfo(nextLink, slug),
        allChapters: mangaSlug ? `/detail-komik/${mangaSlug}` : null,
      },
      additionalDescription,
    });
  } catch (err) {
    console.error("Error fetching chapter:", err);
    res.status(500).json({
      error: "Gagal mengambil data chapter komik",
      detail: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
};

module.exports = { getBacaChapter, extractSlugAndChapter };
