const axios = require("axios");
const { execFile } = require("child_process");
const loadEnv = require("../utils/loadEnv");

loadEnv();

const BASE_URL = "https://doujindesu.tv";
const PLACEHOLDER_IMAGE_RE = /\/asset\/img\/lazy\.jpg/i;
const SITE_NAME = "Doujindesu";
const RESERVED_PATH_SEGMENTS = new Set([
  "",
  "author",
  "blog",
  "category",
  "character",
  "doujin",
  "genre",
  "group",
  "login",
  "manga",
  "page",
  "partner",
  "pasang-iklan",
  "lapor-link-rusak",
  "register",
  "series",
  "tag",
  "wp-admin",
  "wp-content",
  "wp-includes",
]);

function requestHeaders(extraHeaders = {}) {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    Referer: BASE_URL + "/",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    ...(process.env.DOUJINDESU_COOKIE ? { Cookie: process.env.DOUJINDESU_COOKIE } : {}),
    ...extraHeaders,
  };
}

function getAbsoluteUrl(url, baseUrl = BASE_URL) {
  if (!url || typeof url !== "string") return null;

  const trimmedUrl = url.trim();
  if (!trimmedUrl || trimmedUrl.startsWith("data:")) return null;

  try {
    return new URL(trimmedUrl, baseUrl).toString();
  } catch (error) {
    return null;
  }
}

async function fetchHtml(url, options = {}) {
  const absoluteUrl = getAbsoluteUrl(url);
  const method = options.method || (options.data ? "POST" : "GET");
  const headers = requestHeaders(options.headers || {});

  try {
    const { data } = await axios.request({
      ...options,
      url: absoluteUrl,
      method,
      headers,
      timeout: options.timeout || 15000,
    });

    if (isCloudflareBlocked(data)) throw createCloudflareError();

    return data;
  } catch (error) {
    if (![403, 429].includes(error.response?.status)) throw error;
  }

  const data = await fetchHtmlWithCurl(absoluteUrl, headers, {
    data: options.data,
    method,
    timeout: options.timeout || 15000,
  });
  if (isCloudflareBlocked(data)) throw createCloudflareError();
  return data;
}

function isCloudflareBlocked(html) {
  const text = String(html || "");
  return (
    text.includes("Just a moment") ||
    text.includes("cf-browser-verification") ||
    text.includes("cf_chl") ||
    text.includes("Cloudflare")
  );
}

function createCloudflareError() {
  const error = new Error(
    "Doujindesu source is protected by Cloudflare. Set DOUJINDESU_COOKIE with a valid cf_clearance cookie, then restart the API server."
  );
  error.statusCode = 503;
  return error;
}

function fetchHtmlWithCurl(url, headers, options) {
  const timeout = options.timeout;
  const args = [
    "-L",
    "--silent",
    "--show-error",
    "--connect-timeout",
    Math.ceil(timeout / 1000).toString(),
    "--max-time",
    Math.ceil(timeout / 1000 + 10).toString(),
  ];

  Object.entries(headers).forEach(([key, value]) => {
    if (value) args.push("-H", `${key}: ${value}`);
  });

  if (options.method && options.method !== "GET") {
    args.push("-X", options.method);
  }

  if (options.data) {
    const body =
      typeof options.data === "string"
        ? options.data
        : new URLSearchParams(options.data).toString();
    args.push("--data", body);
  }

  args.push(url);

  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "curl.exe" : "curl";
    execFile(command, args, { maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) {
        error.message = stderr || error.message;
        reject(error);
        return;
      }

      resolve(stdout);
    });
  });
}

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function cleanTitle(value) {
  return normalizeText(value)
    .replace(/^Baca\s+(Komik|Manga|Manhwa|Manhua)?\s*/i, "")
    .replace(/^Komik\s+/i, "")
    .trim();
}

function safeText(root, selector) {
  if (!root || !selector) return "";
  return normalizeText(root.find(selector).first().text());
}

function getSrcsetUrl(srcset) {
  if (!srcset) return null;
  const firstCandidate = srcset.split(",")[0]?.trim().split(/\s+/)[0];
  return firstCandidate || null;
}

function getImageUrl($, imgElement) {
  if (!imgElement || !imgElement.length) return null;

  const src =
    imgElement.attr("data-src") ||
    imgElement.attr("data-lazy-src") ||
    imgElement.attr("data-original") ||
    getSrcsetUrl(imgElement.attr("data-srcset") || imgElement.attr("srcset")) ||
    imgElement.attr("src");

  return getAbsoluteUrl(src);
}

function getPathSegments(url) {
  try {
    return new URL(url, BASE_URL).pathname.split("/").filter(Boolean);
  } catch (error) {
    return String(url || "")
      .split("?")[0]
      .split("/")
      .filter(Boolean);
  }
}

function isSameSiteUrl(url) {
  try {
    const absoluteUrl = new URL(url, BASE_URL);
    return absoluteUrl.hostname.replace(/^www\./, "") ===
      new URL(BASE_URL).hostname.replace(/^www\./, "");
  } catch (error) {
    return false;
  }
}

function isMangaDetailUrl(url) {
  if (!url || !isSameSiteUrl(url)) return false;
  const segments = getPathSegments(url);
  return segments.length === 2 && segments[0] === "manga" && Boolean(segments[1]);
}

function isChapterUrl(url) {
  if (!url || !isSameSiteUrl(url) || isMangaDetailUrl(url)) return false;

  const segments = getPathSegments(url);
  const lastSegment = segments[segments.length - 1] || "";
  if (!lastSegment || RESERVED_PATH_SEGMENTS.has(lastSegment)) return false;
  if (RESERVED_PATH_SEGMENTS.has(segments[0])) return false;

  return !/\.(?:jpg|jpeg|png|gif|webp|svg|css|js|ico|zip|rar|7z|pdf)$/i.test(
    lastSegment
  );
}

function isLikelyAdImage(src = "", alt = "") {
  const combined = `${src} ${alt}`;
  return /(?:banner|ads?|iklan|ibo|sbobet|slot|dewa|hoki|koko|gaza|ratu|judi|china777|idks|suroso|pentaslot|sigacor|jpdewa|klik|sport|indo666)/i.test(
    combined
  );
}

function parseTypeFromText(...values) {
  const match = values.map(normalizeText).join(" ").match(/\b(Doujinshi|Manga|Manhwa)\b/i);
  if (!match) return "";
  const type = match[1].toLowerCase();
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function extractMangaSlug(url) {
  if (!url) return "";

  try {
    const { pathname } = new URL(url, BASE_URL);
    return pathname.match(/\/manga\/([^/]+)/i)?.[1] || "";
  } catch (error) {
    return String(url).match(/\/manga\/([^/]+)/i)?.[1] || "";
  }
}

function extractChapterNumber(url, fallbackText = "") {
  if (!url && !fallbackText) return "";

  const text = normalizeText(`${url || ""} ${fallbackText || ""}`);

  try {
    const { pathname } = new URL(url, BASE_URL);
    const lastSegment = getPathSegments(pathname).pop() || "";
    return (
      pathname.match(/chapter[-\s]*([\d.]+)\/?$/i)?.[1] ||
      pathname.match(/\/chapter\/([\d.]+)\/?$/i)?.[1] ||
      lastSegment.match(/-(\d+(?:\.\d+)?)(?:-end)?$/i)?.[1] ||
      text.match(/chapter\s*([\d.]+)/i)?.[1] ||
      text.match(/\b([\d.]+)\s*(?:end)?\b/i)?.[1] ||
      ""
    );
  } catch (error) {
    return (
      text.match(/chapter[-\s]*([\d.]+)/i)?.[1] ||
      text.match(/-(\d+(?:\.\d+)?)(?:-end)?$/i)?.[1] ||
      text.match(/\b([\d.]+)\s*(?:end)?\b/i)?.[1] ||
      ""
    );
  }
}

function extractChapterSlug(url) {
  if (!url) return "";

  try {
    const segments = getPathSegments(url);
    if (segments[0] === "manga") return "";
    return segments[segments.length - 1] || "";
  } catch (error) {
    const segments = getPathSegments(url);
    return segments[segments.length - 1] || "";
  }
}

function getApiChapterLink(chapterUrl, fallbackMangaSlug = "", fallbackText = "") {
  const chapterNumber = extractChapterNumber(chapterUrl, fallbackText);
  const chapterSlug = extractChapterSlug(chapterUrl) || fallbackMangaSlug;
  return chapterSlug && chapterNumber
    ? `/baca-chapter/${chapterSlug}/${chapterNumber}`
    : null;
}

function logEmptyParse(context, html, extra = {}) {
  console.error(`Parsing ${context} kosong dari ${SITE_NAME}.`, {
    ...extra,
    htmlPreview: normalizeText(html).slice(0, 1200),
  });
}

module.exports = {
  BASE_URL,
  PLACEHOLDER_IMAGE_RE,
  SITE_NAME,
  requestHeaders,
  isCloudflareBlocked,
  getAbsoluteUrl,
  fetchHtml,
  normalizeText,
  cleanTitle,
  safeText,
  getImageUrl,
  extractMangaSlug,
  extractChapterNumber,
  extractChapterSlug,
  getApiChapterLink,
  isMangaDetailUrl,
  isChapterUrl,
  isLikelyAdImage,
  parseTypeFromText,
  logEmptyParse,
};
