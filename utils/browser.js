const cheerio = require("cheerio");
const { chromium } = require("playwright");
const loadEnv = require("./loadEnv");

loadEnv();

const BASE_URL = "https://doujindesu.tv";
const DEFAULT_TTL = 5 * 60 * 1000;
const CHAPTER_TTL = 60 * 60 * 1000;
const cache = new Map();
let browser;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }

  return browser;
}

async function getPage() {
  const activeBrowser = await getBrowser();
  const context = await activeBrowser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "id-ID",
  });

  await addCookieHeaderToContext(context);
  const page = await context.newPage();
  return { context, page };
}

async function fetchHTMLWithBrowser(url) {
  const absoluteUrl = new URL(url, BASE_URL).toString();
  const { context, page } = await getPage();

  try {
    await page.goto(absoluteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForSelector("body", { timeout: 30000 });
    await waitForReaderIfNeeded(page, absoluteUrl);
    await page.waitForTimeout(2500);

    const html = await page.content();
    if (isCloudflareBlocked(html)) {
      throw new Error("Cloudflare challenge still detected");
    }

    return cheerio.load(html);
  } catch (error) {
    const wrapped = new Error(
      "Failed to fetch Doujindesu with browser renderer. Source may still be protected by Cloudflare."
    );
    wrapped.cause = error;
    wrapped.statusCode = 503;
    throw wrapped;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function cachedFetchHTML(url, ttl = DEFAULT_TTL) {
  const absoluteUrl = new URL(url, BASE_URL).toString();
  const cached = cache.get(absoluteUrl);

  if (cached && Date.now() - cached.createdAt < ttl) {
    return cheerio.load(cached.html);
  }

  const $ = await fetchHTMLWithBrowser(absoluteUrl);
  const html = $.html();
  cache.set(absoluteUrl, { html, createdAt: Date.now() });
  return cheerio.load(html);
}

async function cachedFetchPageHTML(url, ttl = DEFAULT_TTL) {
  const $ = await cachedFetchHTML(url, ttl);
  return $.html();
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

async function waitForReaderIfNeeded(page, url) {
  const pathname = new URL(url, BASE_URL).pathname;
  const segments = pathname.split("/").filter(Boolean);
  const looksLikeChapter = segments.length === 1 && !["genre", "manga", "doujin"].includes(segments[0]);

  if (!looksLikeChapter) return;

  await page.waitForTimeout(5000);
  await injectReaderImages(page);

  await page
    .waitForFunction(
      () => {
        const ajaxReader = document.querySelector("#anu");
        const ajaxImages = Array.from(document.querySelectorAll("#anu img"));
        const ajaxHtml = ajaxReader?.innerHTML || "";
        return ajaxImages.some((img) => img.currentSrc || img.src || img.dataset.src) || ajaxHtml.length > 100;
      },
      { timeout: 45000 }
    )
    .catch(() => {});
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
        redirect: "manual",
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

async function addCookieHeaderToContext(context) {
  const cookieHeader = process.env.DOUJINDESU_COOKIE;
  if (!cookieHeader) return;
  if (!/cf_clearance=/i.test(cookieHeader)) return;

  const cookies = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) return null;

      return {
        name: part.slice(0, separator).trim(),
        value: part.slice(separator + 1).trim(),
        domain: "doujindesu.tv",
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      };
    })
    .filter((cookie) => cookie && cookie.name);

  if (cookies.length) {
    await context.addCookies(cookies);
  }
}

function isCloudflareBlocked(html) {
  const text = String(html || "");
  return (
    text.includes("Just a moment") ||
    text.includes("cf-browser-verification") ||
    text.includes("cf_chl") ||
    text.includes("__cf_chl") ||
    text.includes("Cloudflare")
  );
}

module.exports = {
  CHAPTER_TTL,
  DEFAULT_TTL,
  cachedFetchHTML,
  cachedFetchPageHTML,
  closeBrowser,
  fetchHTMLWithBrowser,
  getBrowser,
  getPage,
  isCloudflareBlocked,
};
