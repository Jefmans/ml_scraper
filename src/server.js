#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { coerceBoolean, coerceNumber, normalizeTargetUrl } from "./options.js";
import { scrapeUrl } from "./scraper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
const DEFAULT_HOST = process.env.HOST || "0.0.0.0";
const DEFAULT_PORT = coerceNumber(process.env.PORT, 3000);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

export function parseServerArgs(argv) {
  const args = [...argv];
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT
  };

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    const [rawKey, inlineValue] = token.split("=", 2);
    const key = rawKey.replace(/^-+/, "");
    const nextValue = inlineValue ?? args.shift();

    switch (key) {
      case "host":
        options.host = nextValue || options.host;
        break;
      case "port":
        options.port = coerceNumber(nextValue, options.port);
        break;
      default:
        throw new Error(`Unknown server option: ${token}`);
    }
  }

  return options;
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > 1_000_000) {
      throw new Error("Request body is too large.");
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function mapScrapeOptions(body) {
  return {
    waitUntil: body.waitUntil ?? "networkidle",
    timeout: coerceNumber(body.timeout, 45_000),
    delay: coerceNumber(body.delay, 1_000),
    headless: coerceBoolean(body.headless, true),
    autoScroll: coerceBoolean(body.scroll, true),
    expandContent: coerceBoolean(body.expand, true),
    captureJsonResponseBodies: coerceBoolean(body.networkBodies, true),
    maxJsonBodyBytes: coerceNumber(body.maxJsonBodyBytes, 200_000),
    includeHtml: coerceBoolean(body.includeHtml, false),
    includeScreenshot: coerceBoolean(body.includeScreenshot, false)
  };
}

async function serveStaticFile(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));
  const relativePath = path.relative(PUBLIC_DIR, safePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const file = await fs.readFile(safePath);
    const extension = path.extname(safePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=300"
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    response.end(file);
  } catch (error) {
    if (error?.code === "ENOENT") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    throw error;
  }
}

function createRequestHandler() {
  return async (request, response) => {
    const origin = `http://${request.headers.host || "localhost"}`;
    const url = new URL(request.url || "/", origin);

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          service: "playwright-scraper",
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/scrape") {
        const body = await readJsonBody(request);
        const targetUrl = normalizeTargetUrl(body.url);
        const result = await scrapeUrl(targetUrl, mapScrapeOptions(body));
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET" || request.method === "HEAD") {
        await serveStaticFile(request, response, url.pathname);
        return;
      }

      sendJson(response, 405, { error: "Method not allowed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error";
      const statusCode = /url|json|body|option|boolean|numeric|supported/i.test(message) ? 400 : 500;
      sendJson(response, statusCode, { error: message });
    }
  };
}

export function createServer() {
  return http.createServer(createRequestHandler());
}

export async function startServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    server,
    host,
    port: server.address().port
  };
}

export async function runServer(argv = process.argv.slice(2)) {
  const options = parseServerArgs(argv);
  const { server, host, port } = await startServer(options);
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  process.stdout.write(`Scraper UI running at http://${displayHost}:${port}\n`);

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { server, host, port };
}

function isDirectRun() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  runServer()
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}
