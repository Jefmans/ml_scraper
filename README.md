# Domain Agnostic Playwright Scraper

This project exposes a small CLI that renders a page with Playwright and emits a broad JSON snapshot of what it finds. The extractor is intentionally generic, so it is useful across blogs, product pages, docs sites, landing pages, and applications that render content client-side.

It now supports two ways to use it:

- A CLI for one-off scrapes
- A browser-based frontend backed by a local HTTP API

## What it captures

- Page metadata: title, language, canonical URL, description, keywords, favicon, body text, word count
- DOM content: headings, text blocks, links, images, lists, tables, forms, buttons, iframes, videos
- Structured data: meta tags, Open Graph, Twitter cards, JSON-LD
- Page state: cookies, local storage, session storage
- Network activity: request metadata and JSON/XHR response bodies when they are reasonably sized
- Artifacts: rendered HTML and a full-page screenshot

## Install

```bash
npm install
```

The scraper first tries installed browser channels (`msedge`, then `chrome`). If neither is available, install Chromium for Playwright:

```bash
npx playwright install chromium
```

## Usage

```bash
npm run scrape -- https://example.com --out scrapes/example.json
```

Start the frontend and API locally:

```bash
npm run serve
```

Then open `http://localhost:3000` in your browser, paste a URL, and run the scrape from the UI.

Useful flags:

```bash
node src/index.js https://example.com \
  --out scrapes/example.json \
  --html scrapes/example.html \
  --screenshot scrapes/example.png \
  --wait-until networkidle \
  --timeout 45000 \
  --delay 1000 \
  --scroll true \
  --expand true \
  --network-bodies true
```

## Browser UI and API

The frontend is served from the same Node process as the scraper API.

- `GET /` serves the browser UI
- `GET /api/health` returns a simple health payload
- `POST /api/scrape` accepts JSON with at least a `url` field

Example API request:

```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","waitUntil":"load"}'
```

## Docker

Yes. This project can run in Docker on a server.

Build the image:

```bash
docker build -t playwright-scraper .
```

Run the browser UI and API on a server:

```bash
docker run --rm --init --ipc=host -p 3000:3000 playwright-scraper
```

Then open `http://localhost:3000` or your server's public host on port `3000`.

Run a one-off CLI scrape inside the same image:

```bash
docker run --rm --init --ipc=host \
  playwright-scraper \
  scrape https://example.com
```

Run a CLI scrape and persist files to a host-mounted directory:

```bash
docker run --rm --init --ipc=host \
  -v "$(pwd)/scrapes:/app/scrapes" \
  playwright-scraper \
  scrape https://example.com \
  --out /app/scrapes/example.json \
  --html /app/scrapes/example.html \
  --screenshot /app/scrapes/example.png
```

Notes for server use:

- `--init` helps reap Chromium child processes cleanly.
- `--ipc=host` avoids Chrome shared-memory issues under heavier pages.
- The same image now supports both UI/API mode and one-off CLI scraping.
- If you schedule scraping in cron, a queue worker, or a Kubernetes Job, mount a volume or upload the JSON to object storage after each run.

## Output shape

The scraper returns a single JSON object with these top-level sections:

- `request`
- `browser`
- `page`
- `metaTags`
- `social`
- `headings`
- `textBlocks`
- `links`
- `images`
- `lists`
- `tables`
- `forms`
- `buttons`
- `iframes`
- `videos`
- `scripts`
- `stylesheets`
- `jsonLd`
- `storage`
- `cookies`
- `network`
- `artifacts`

## Notes

- "All data" on the public web is unbounded, so this implementation targets the major content and metadata surfaces a generic scraper can collect reliably.
- Some sites require authentication, anti-bot handling, or custom interaction flows. Those cases usually need site-specific extensions on top of this generic baseline.
