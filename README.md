# Domain Agnostic Playwright Scraper

This project exposes a small CLI that renders a page with Playwright and emits a broad JSON snapshot of what it finds. The extractor is intentionally generic, so it is useful across blogs, product pages, docs sites, landing pages, and applications that render content client-side.

It now supports two ways to use it:

- A CLI for one-off scrapes
- A browser-based frontend backed by a local HTTP API
- A browser UI with local scrape history

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

The UI keeps a local scrape history in your browser so you can reload recent runs, inspect a stored preview, and reuse prior URLs and options after refreshes.

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

## Security and rate limiting

For public deployment, you can protect the UI and scrape endpoint with HTTP basic auth and apply an in-memory rate limit to `POST /api/scrape`.

Environment variables:

- `BASIC_AUTH_USER`: username for browser and API access
- `BASIC_AUTH_PASSWORD`: password for browser and API access
- `BASIC_AUTH_REALM`: optional auth realm label. Default: `Field Scraper`
- `RATE_LIMIT_MAX_REQUESTS`: enable rate limiting with a max request count per window
- `RATE_LIMIT_WINDOW_MS`: optional window size in milliseconds. Default: `60000`
- `TRUST_PROXY`: set to `true` when running behind a reverse proxy and you want rate limiting to respect `X-Forwarded-For`

Notes:

- Basic auth applies to the UI and scrape endpoint when configured.
- `GET /api/health` remains open for container and load balancer health checks.
- Rate limiting is disabled unless `RATE_LIMIT_MAX_REQUESTS` is set.

Example API request:

```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","waitUntil":"load"}'
```

## Docker

Yes. This project can run in Docker on a server.

For an actual server deployment, `docker compose` is usually easier than long `docker run` commands because it keeps the service config, ports, mounts, and auth/rate-limit settings in one file.

This repository now includes [docker-compose.yml](C:\Users\Echos Bv\Desktop\Development\ml_scraper\docker-compose.yml) with:

- `scraper`: the browser UI and API on port `3000`
- `portainer_agent`: the Portainer agent on port `9001`, behind the optional `ops` profile

Build the image:

```bash
docker build -t playwright-scraper .
```

Start the stack with Docker Compose:

```bash
cp .env.example .env
docker compose up -d --build
```

Stop it:

```bash
docker compose down
```

The default compose settings:

- expose the scraper on `0.0.0.0:3000`
- bind the Portainer agent to `127.0.0.1:9001` by default, which is safer than exposing it publicly
- mount `./scrapes` into the container at `/app/scrapes`
- allow auth and rate limiting to be configured through `.env`
- do not start the Portainer agent unless you opt into the `ops` profile

Run the browser UI and API on a server:

```bash
docker run --rm --init --ipc=host -p 3000:3000 playwright-scraper
```

Then open `http://localhost:3000` or your server's public host on port `3000`.

Run the protected server variant:

```bash
docker run --rm --init --ipc=host -p 3000:3000 \
  -e BASIC_AUTH_USER=admin \
  -e BASIC_AUTH_PASSWORD=change-me \
  -e RATE_LIMIT_MAX_REQUESTS=10 \
  -e RATE_LIMIT_WINDOW_MS=60000 \
  playwright-scraper
```

With Compose, the equivalent protected setup is just updating `.env` and starting the stack:

```bash
docker compose up -d --build
```

Start the scraper plus Portainer agent on a Linux server:

```bash
docker compose --profile ops up -d --build
```

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
- For public deployments, set `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD`, and `RATE_LIMIT_MAX_REQUESTS`.
- Keep the Portainer agent bound to `127.0.0.1` unless you intentionally want to expose it through a firewall or reverse tunnel.
- The `portainer_agent` service uses Linux Docker host mounts, so it is intended for a Linux server, not a Windows Docker Desktop dev loop.
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
