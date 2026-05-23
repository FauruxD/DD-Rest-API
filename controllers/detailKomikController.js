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
  extractChapterSlug,
  isMangaDetailUrl,
  isChapterUrl,
  isLikelyAdImage,
  parseTypeFromText,
  logEmptyParse,
} = require("./scraperUtils");

function getChapterApiLink(chapterLink) {
  const chapterSlug = extractChapterSlug(chapterLink);
  const chapterNumber = extractChapterNumber(chapterLink);
  return chapterSlug && chapterNumber
    ? `/baca-chapter/${chapterSlug}/${chapterNumber}`
    : null;
}

function parseChapterLink($, linkElement) {
  const originalLink = getAbsoluteUrl(linkElement.attr("href"));
  const title =
    normalizeText(linkElement.find("span").last().text()) ||
    normalizeText(linkElement.text()) ||
    normalizeText(linkElement.attr("title"));
  const chapterNumber = extractChapterNumber(originalLink, title);

  return {
    title,
    originalLink,
    apiLink:
      extractChapterSlug(originalLink) && chapterNumber
        ? `/baca-chapter/${extractChapterSlug(originalLink)}/${chapterNumber}`
        : getChapterApiLink(originalLink),
    chapterNumber,
  };
}

function parseInfoFromText($) {
  const info = {};
  const bodyText = normalizeText($("body").text());
  const labels = ["Status", "Type", "Series", "Author", "Rating", "Created Date"];

  labels.forEach((label, index) => {
    const nextLabel = labels[index + 1];
    const pattern = nextLabel
      ? new RegExp(`${label}\\s+(.+?)\\s+${nextLabel}\\b`, "i")
      : new RegExp(`${label}\\s+([^#]+?)(?:\\s+Daftar Chapter|\\s+You May Also Like|$)`, "i");
    const match = bodyText.match(pattern);
    if (match?.[1]) info[label] = normalizeText(match[1]);
  });

  return info;
}

function getContentImage($, title) {
  const metaImage =
    getAbsoluteUrl($('meta[property="og:image"]').attr("content")) ||
    getAbsoluteUrl($('meta[itemprop="image"]').attr("content"));
  if (metaImage && !isLikelyAdImage(metaImage, title)) return metaImage;

  const images = $("article img, main img, .entry-content img, .thumbnail img, img")
    .toArray()
    .map((img) => ({
      src: getImageUrl($, $(img)),
      alt: normalizeText($(img).attr("alt")),
    }))
    .filter((img) => img.src && !isLikelyAdImage(img.src, img.alt));

  const titleWords = normalizeText(title).toLowerCase().split(/\s+/).slice(0, 4);
  const matchingImage = images.find((img) =>
    titleWords.some((word) => word && img.alt.toLowerCase().includes(word))
  );

  return matchingImage?.src || images[0]?.src || null;
}

async function scrapeKomikDetail(url) {
  const data = await fetchHtml(url);
  const $ = cheerio.load(data);

  const title =
    normalizeText($("h1 [itemprop='name']").first().text()) ||
    normalizeText($("h1.title").clone().children(".alter").remove().end().text()) ||
    normalizeText($(".metadata h1.title, .metadata .title").first().clone().children(".alter").remove().end().text()) ||
    normalizeText($("h1").filter((_, el) => normalizeText($(el).text())).first().text()) ||
    normalizeText($('meta[property="og:title"]').attr("content")).replace(/\s*-\s*Doujindesu\..*$/i, "");
  const alternativeTitle =
    normalizeText($("p.j2").first().text()) ||
    normalizeText($(".alternative, .alter, .aliases").first().text());
  const description =
    normalizeText($("p.desc").first().text()) ||
    normalizeText($("article p, main p").first().text());
  const sinopsis =
    normalizeText($("section#Sinopsis p").first().text()) ||
    normalizeText(
      $("section")
        .filter((_, el) => /sinopsis/i.test(normalizeText($(el).text())))
        .find("p")
        .first()
        .text()
    );

  const thumbnail =
    getImageUrl($, $("section#Informasi img").first()) ||
    getContentImage($, title);

  const infoTable = parseInfoFromText($);
  $("section#Informasi table tr, section#Informasi .inftable tr, .metadata table tr").each(
    (_, el) => {
      const cells = $(el).find("td, th");
      const key = normalizeText(cells.first().text()).replace(/:$/, "");
      const value = normalizeText(cells.last().text());
      if (key && value && key !== value) infoTable[key] = value;
    }
  );

  const genres = [
    ...new Set(
      [
        ...$("section#Informasi a[href*='/genre/'], section#Informasi ul.genre li, a[href*='/genre/']")
          .toArray()
          .map((el) => normalizeText($(el).text())),
        ...$("meta[itemprop='genre']")
          .toArray()
          .map((el) => normalizeText($(el).attr("content"))),
      ].filter(Boolean)
    ),
  ];

  const komikSlug = extractMangaSlug(url);

  const chapters = [];
  const chapterRows = $("section#Chapter table tr, table#Daftar_Chapter tr, .eplister li, .chapter-list li, .episodelist li, .bxcl, .eps")
    .toArray()
    .filter((el) =>
      $(el)
        .find("a[href]")
        .toArray()
        .some((link) => isChapterUrl($(link).attr("href")))
    );

  chapterRows.forEach((el) => {
    const row = $(el);
    const chapterLinkElement = row
      .find("a[href]")
      .filter((_, link) => isChapterUrl($(link).attr("href")))
      .first();
    const chapter = parseChapterLink($, chapterLinkElement);
    const cells = row.find("td");
    chapters.push({
      ...chapter,
      views: normalizeText(row.find(".pembaca, td.pembaca, i").first().text()),
      date:
        normalizeText(row.find(".tanggalseries").first().text()) ||
        normalizeText(cells.last().text()),
    });
  });

  if (!chapters.length) {
    $("a[href]").each((_, el) => {
      if (!isChapterUrl($(el).attr("href"))) return;
      const chapter = parseChapterLink($, $(el));
      if (chapter.originalLink && chapter.title) {
        chapters.push({ ...chapter, views: "", date: "" });
      }
    });
  }

  const uniqueChapters = chapters.filter(
    (chapter, index, allChapters) =>
      chapter.originalLink &&
      allChapters.findIndex((item) => item.originalLink === chapter.originalLink) ===
        index
  );

  const similarKomik = [];
  $("section#Spoiler, section")
    .filter((_, el) => /Komik Serupa/i.test(normalizeText($(el).text())))
    .find('a[href*="/manga/"]')
    .each((_, el) => {
      const linkElement = $(el);
      if (!isMangaDetailUrl(linkElement.attr("href"))) return;
      const card = linkElement.closest("article, li, div");
      const originalLink = getAbsoluteUrl(linkElement.attr("href"));
      const slug = extractMangaSlug(originalLink);
      const img = card.find("img").first();
      const type =
        normalizeText(card.find("strong, b").first().text()) ||
        normalizeText(card.find("[itemprop='additionalType']").attr("content")) ||
        parseTypeFromText(card.text());

      const item = {
        title:
          cleanTitle(card.find(".h4, h3, h4").first().text()) ||
          cleanTitle(linkElement.attr("title")) ||
          cleanTitle(img.attr("alt")),
        originalLink,
        apiLink: slug ? `/detail-komik/${slug}` : null,
        thumbnail: getImageUrl($, img),
        type,
        genres: normalizeText(card.find(".tpe1_inf").text()).replace(type, "").trim(),
        synopsis: normalizeText(card.find("p").first().text()),
        views: normalizeText(card.find(".vw").first().text()),
        slug,
      };

      if (
        item.title &&
        item.originalLink &&
        !similarKomik.some((komik) => komik.slug === item.slug)
      ) {
        similarKomik.push(item);
      }
    });

  if (!title || !thumbnail || !uniqueChapters.length) {
    logEmptyParse("GET /detail-komik", data, {
      target: url,
      titleFound: !!title,
      thumbnailFound: !!thumbnail,
      chaptersFound: uniqueChapters.length,
      selectors: "h1, img, a[href] chapter links",
    });
  }

  return {
    title,
    alternativeTitle,
    description,
    sinopsis,
    thumbnail,
    info: infoTable,
    genres,
    slug: komikSlug,
    // firstChapter,
    // latestChapter,
    chapters: uniqueChapters,
    similarKomik,
  };
}

const getDetail = async (req, res) => {
  try {
    const { slug } = req.params;
    const komikUrl = `${BASE_URL}/manga/${slug}/`;
    const komikDetail = await scrapeKomikDetail(komikUrl);

    if (!komikDetail.title || !komikDetail.chapters.length) {
      return res.status(502).json({
        error: "Gagal parsing detail komik dari Doujindesu.",
        detail:
          "Struktur HTML detail komik kemungkinan berubah atau data chapter kosong.",
      });
    }

    res.json(komikDetail);
  } catch (err) {
    console.error("Error fetching komik detail:", err);
    res.status(500).json({
      error: "Gagal mengambil detail komik",
      detail: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
};

module.exports = { getDetail };
