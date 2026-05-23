const axios = require("axios");
const cheerio = require("cheerio");
const { chromium } = require("playwright");
const loadEnv = require("../../utils/loadEnv");

loadEnv();

const BASE_URL = "https://doujindesu.tv";
const DEFAULT_TTL = 10 * 60 * 1000;
const CHAPTER_TTL = 60 * 60 * 1000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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
        "Failed to fetch Doujindesu. Axios was blocked and Playwright fallback failed."
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
  const cookies = parseCookieString(process.env.DOUJINDESU_COOKIE || "");

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
        domain: ".doujindesu.tv",
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
  await injectReaderImages(page);
  await page
    .waitForFunction(
      () => {
        const images = Array.from(document.querySelectorAll("#anu img"));
        return images.some((img) => /desu\.photos|storage\/uploads/i.test(img.src || ""));
      },
      { timeout: 45000 }
    )
    .catch(() => {});
  await page.waitForTimeout(1500);
}

async function injectReaderImages(page) {
  await page
    .evaluate(async () => {
      const reader = document.querySelector("#reader");
      const id = reader?.getAttribute("data-id");
      if (!id) return;

      const response = await fetch("/themes/ajax/ch.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: new URLSearchParams({ id }),
        credentials: "same-origin",
        redirect: "follow",
      });
      const html = await response.text();
      const target = document.querySelector("#anu") || document.createElement("div");
      target.id = "anu";
      target.innerHTML = html;

      if (!target.parentElement) {
        reader.appendChild(target);
      }
    })
    .catch(() => {});
}

function hasReaderImages(html) {
  return /desu\.photos|storage\/uploads/i.test(String(html || ""));
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
    Cookie: process.env.DOUJINDESU_COOKIE || "",
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
