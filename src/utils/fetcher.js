const axios = require("axios");
const cheerio = require("cheerio");
const { chromium } = require("playwright");
const loadEnv = require("../../utils/loadEnv");

loadEnv();

const BASE_URL = "https://komiktap.info";
const DEFAULT_TTL = 10 * 60 * 1000;
const CHAPTER_TTL = 60 * 60 * 1000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const READER_IMAGE_SELECTOR = [
  ".ts-main-image",
  "#readerarea img",
  ".reading-content img",
  ".readerarea img",
  ".reader-area img",
  "#reader img",
  ".chapter-content img",
  ".entry-content img.ts-main-image",
  "article img.ts-main-image",
].join(",");
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

const cache = new Map();
let browser;

async function fetchHTML(url, options = {}) {
  const absoluteUrl = absoluteUrlFor(url);
  const ttl = options.ttl || DEFAULT_TTL;
  const cached = getCachedHTML(absoluteUrl);

  if (cached) {
    log("cache hit", absoluteUrl);
    return cheerio.load(cached);
  }

  let axiosError = null;
  try {
    const axiosResult = await fetchWithAxios(absoluteUrl);
    if (!isCloudflareBlocked(axiosResult.html, axiosResult.statusCode)) {
      if (!options.requireReaderImages || hasReaderImages(axiosResult.html)) {
        setCachedHTML(absoluteUrl, axiosResult.html, ttl);
        log("axios ok", absoluteUrl);
        return cheerio.load(axiosResult.html);
      }

      axiosError = new Error("Static HTML does not include reader images");
      axiosError.statusCode = 503;
    } else {
      axiosError = new Error("Axios response blocked by Cloudflare");
      axiosError.statusCode = axiosResult.statusCode || 503;
    }
  } catch (error) {
    axiosError = error;
  }

  if (isFallbackError(axiosError)) {
    log("axios blocked, fallback playwright", absoluteUrl);
    try {
      const html = await fetchWithPlaywright(absoluteUrl, options);
      setCachedHTML(absoluteUrl, html, ttl);
      log("playwright ok", absoluteUrl);
      return cheerio.load(html);
    } catch (playwrightError) {
      const error = new Error(
        "Failed to fetch Komiktap. Axios was blocked and Playwright fallback failed."
      );
      error.statusCode = 503;
      error.cause = playwrightError;
      throw error;
    }
  }

  throw axiosError;
}

async function fetchWithAxios(url) {
  const response = await axios.get(url, {
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: getRequestHeaders(),
  });

  return {
    html: response.data,
    statusCode: response.status,
  };
}

async function fetchWithPlaywright(url, options = {}) {
  const activeBrowser = await getBrowser();
  const context = await activeBrowser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: "id-ID",
  });
  const cookies = parseCookieString(process.env.KOMIKTAP_COOKIE || process.env.DOUJINDESU_COOKIE || "");

  if (cookies.length) {
    await context.addCookies(cookies);
  }

  await context.route("**/*", (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    const requestUrl = request.url();

    if (["image", "font", "stylesheet", "media"].includes(resourceType)) {
      return route.abort();
    }

    if (/(doubleclick|googlesyndication|histats|analytics|facebook|twitter|adservice)/i.test(requestUrl)) {
      return route.abort();
    }

    return route.continue();
  });

  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector("body", { timeout: 30000 });

    if (options.requireReaderImages) {
      await waitForReaderImages(page);
    } else {
      await page.waitForTimeout(2000);
    }

    const html = await page.content();
    if (isCloudflareBlocked(html)) {
      throw new Error("Cloudflare challenge still detected");
    }

    return html;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

function isCloudflareBlocked(html, statusCode) {
  const text = String(html || "").toLowerCase();

  return (
    statusCode === 403 ||
    statusCode === 503 ||
    text.includes("just a moment") ||
    text.includes("checking your browser") ||
    text.includes("cf-browser-verification") ||
    text.includes("cf_chl") ||
    text.includes("__cf_chl") ||
    text.includes("cloudflare") ||
    text.includes("attention required")
  );
}

function getCachedHTML(url) {
  const absoluteUrl = absoluteUrlFor(url);
  const cached = cache.get(absoluteUrl);

  if (!cached || Date.now() > cached.expiresAt) {
    if (cached) cache.delete(absoluteUrl);
    return null;
  }

  return cached.html;
}

function setCachedHTML(url, html, ttl = DEFAULT_TTL) {
  const absoluteUrl = absoluteUrlFor(url);
  cache.set(absoluteUrl, {
    html,
    expiresAt: Date.now() + ttl,
  });
}

function parseCookieString(cookieString) {
  return String(cookieString || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) return null;

      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (!name) return null;

      return {
        name,
        value,
        domain: ".komiktap.info",
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      };
    })
    .filter(Boolean);
}

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }

  return browser;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

async function waitForReaderImages(page) {
  await page.waitForTimeout(5000);
  await page
    .waitForFunction(
      ({ selector, sourceAttributes, blockedPattern }) => {
        const blocked = new RegExp(blockedPattern, "i");
        const srcFromSet = (srcset) =>
          String(srcset || "").split(",")[0]?.trim().split(/\s+/)[0] || "";
        const getImageSource = (img) => {
          for (const attribute of sourceAttributes) {
            const value = img.getAttribute(attribute);
            if (value) return value;
          }

          return (
            srcFromSet(img.getAttribute("data-srcset") || img.getAttribute("srcset")) ||
            img.currentSrc ||
            img.src ||
            img.getAttribute("src") ||
            ""
          );
        };
        const images = Array.from(
          document.querySelectorAll(selector)
        );
        return images.some((img) => {
          const src = getImageSource(img);
          const context = [
            src,
            img.getAttribute("alt"),
            img.getAttribute("class"),
            img.getAttribute("id"),
          ].join(" ");

          return /\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(src || "") && !blocked.test(context);
        });
      },
      {
        selector: READER_IMAGE_SELECTOR,
        sourceAttributes: IMAGE_SOURCE_ATTRIBUTES,
        blockedPattern: NON_READER_IMAGE_RE.source,
      },
      { timeout: 45000 }
    )
    .catch(() => {});
  await page.waitForTimeout(1500);
}

function hasReaderImages(html) {
  const $ = cheerio.load(String(html || ""));

  return collectReaderImageSources($).length > 0;
}

function collectReaderImageSources($) {
  const sources = [];

  $(READER_IMAGE_SELECTOR).each((_, element) => {
    const img = $(element);
    const src = getReaderImageSource(img);
    const context = [
      src,
      img.attr("alt"),
      img.attr("class"),
      img.attr("id"),
    ].join(" ");

    if (isReaderImageSource(src, context)) sources.push(src);
  });

  return [...new Set(sources)];
}

function getReaderImageSource(img) {
  for (const attribute of IMAGE_SOURCE_ATTRIBUTES) {
    const value = img.attr(attribute);
    if (value) return absoluteUrlFor(value);
  }

  const srcset = firstSrcset(img.attr("data-srcset") || img.attr("srcset"));
  if (srcset) return absoluteUrlFor(srcset);

  return img.attr("src") ? absoluteUrlFor(img.attr("src")) : "";
}

function firstSrcset(srcset) {
  return String(srcset || "").split(",")[0]?.trim().split(/\s+/)[0] || "";
}

function isReaderImageSource(src, context = "") {
  if (!src || !/\.(?:jpe?g|png|webp|gif)(?:[?#].*)?$/i.test(src)) return false;
  return !NON_READER_IMAGE_RE.test(`${src} ${context}`);
}

function isFallbackError(error) {
  return (
    !error ||
    error.statusCode === 403 ||
    error.statusCode === 503 ||
    error.response?.status === 403 ||
    error.response?.status === 503 ||
    /cloudflare|blocked|reader images|timeout/i.test(error.message || "")
  );
}

function getRequestHeaders() {
  return {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    Referer: `${BASE_URL}/`,
    Cookie: process.env.KOMIKTAP_COOKIE || process.env.DOUJINDESU_COOKIE || "",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
}

function absoluteUrlFor(url) {
  return new URL(url, BASE_URL).toString();
}

function log(event, url) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[fetcher] ${event}: ${url}`);
}

module.exports = {
  CHAPTER_TTL,
  DEFAULT_TTL,
  closeBrowser,
  fetchHTML,
  fetchWithAxios,
  fetchWithPlaywright,
  getCachedHTML,
  isCloudflareBlocked,
  parseCookieString,
  setCachedHTML,
};
