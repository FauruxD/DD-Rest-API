Personal website built with Next.js, TypeScript, and Tailwind CSS.

## Doujindesu API Docs

![Doujindesu API Docs preview](./img/doujindesu-api-docs-preview.svg)

API base URL:

```txt
https://doujindesu-rest-api.vercel.app
```

Quick test:

```bash
curl https://doujindesu-rest-api.vercel.app/terbaru
curl https://doujindesu-rest-api.vercel.app/detail-komik/arasau-dokushin-josei-kyoushi-wa-shishunki-danshi-nanka-yori-tamatten-dayo
curl https://doujindesu-rest-api.vercel.app/baca-chapter/arasau-dokushin-josei-kyoushi-wa-shishunki-danshi-nanka-yori-tamatten-dayo/1
```

## Local Development

```bash
npm install
npm run dev
```

Then open:

```txt
http://localhost:3000/doujindesu-api-docs
```

## Doujindesu Cookie

This API uses a hybrid fetcher for Doujindesu pages:

1. Try Axios first for fast requests.
2. Detect Cloudflare/block responses.
3. Fall back to Playwright only when Axios is blocked or a chapter page needs rendered reader images.
4. Cache fetched HTML so Playwright is not called repeatedly for the same URL.

Playwright fallback is not recommended on Vercel serverless due to browser binary, cold start, and timeout limits. Render, Railway, Fly.io, or a VPS are better fits for this API. If deploying to Render, make sure `postinstall` runs `npx playwright install chromium`.

Doujindesu may still protect pages with Cloudflare. If scraping returns a Cloudflare error, add a browser cookie to `.env`:

```env
DOUJINDESU_COOKIE=
```

How to get the cookie:

1. Open `https://doujindesu.tv` in your browser.
2. Open DevTools and inspect cookies for `doujindesu.tv`.
3. Copy the cookie string, including `cf_clearance` when Cloudflare asks for verification.
4. Paste it into `.env` as `DOUJINDESU_COOKIE=...`.
5. Restart the API server after changing `.env`.

Do not commit `.env`. Cookies can expire, so repeat the steps when requests start failing again.

Quick local test:

```bash
curl http://localhost:3001/api/doujin
curl http://localhost:3001/api/manga
curl http://localhost:3001/api/detail/amaama-downer-gal-wa-yasashiku-tsutsumikomu
```
