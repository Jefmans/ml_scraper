#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { coerceBoolean, coerceNumber, normalizeTargetUrl } from "./options.js";
import { scrapeUrl } from "./scraper.js";

function printHelp() {
  const helpText = `
Usage:
  node src/index.js <url> [options]
  npm run scrape -- <url> [options]

Options:
  --url <value>               Target URL. You can also pass it as the first argument.
  --out <file>                Write JSON output to a file instead of stdout.
  --html <file>               Save the rendered HTML snapshot to a file.
  --screenshot <file>         Save a screenshot after extraction.
  --wait-until <event>        Playwright wait strategy: load | domcontentloaded | networkidle
  --timeout <ms>              Navigation timeout in milliseconds. Default: 45000
  --delay <ms>                Extra wait after navigation. Default: 1000
  --headless <bool>           Launch headless browser. Default: true
  --scroll <bool>             Auto-scroll to trigger lazy content. Default: true
  --expand <bool>             Try to open common "show more" controls. Default: true
  --network-bodies <bool>     Capture JSON/XHR response bodies when feasible. Default: true
  --max-json-body-bytes <n>   Max JSON response body size to persist. Default: 200000
  --help                      Show this message.
`;

  process.stdout.write(helpText.trimStart());
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    url: null,
    out: null,
    html: null,
    screenshot: null,
    waitUntil: "networkidle",
    timeout: 45_000,
    delay: 1_000,
    headless: true,
    scroll: true,
    expand: true,
    networkBodies: true,
    maxJsonBodyBytes: 200_000
  };

  const readValue = (token, index) => {
    if (token.includes("=")) {
      return { value: token.split("=", 2)[1], consumedNext: false };
    }

    const candidate = args[index];
    if (!candidate || candidate.startsWith("-")) {
      return { value: undefined, consumedNext: false };
    }

    return { value: candidate, consumedNext: true };
  };

  while (args.length > 0) {
    const token = args.shift();

    if (!token) {
      continue;
    }

    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }

    if (!token.startsWith("-") && !options.url) {
      options.url = token;
      continue;
    }

    const [rawKey] = token.split("=", 1);
    const key = rawKey.replace(/^-+/, "");
    const { value: nextValue, consumedNext } = readValue(token, 0);
    if (consumedNext) {
      args.shift();
    }

    switch (key) {
      case "url":
        options.url = nextValue;
        break;
      case "out":
        options.out = nextValue;
        break;
      case "html":
        options.html = nextValue;
        break;
      case "screenshot":
        options.screenshot = nextValue;
        break;
      case "wait-until":
        options.waitUntil = nextValue ?? options.waitUntil;
        break;
      case "timeout":
        options.timeout = coerceNumber(nextValue, options.timeout);
        break;
      case "delay":
        options.delay = coerceNumber(nextValue, options.delay);
        break;
      case "headless":
        options.headless = coerceBoolean(nextValue, true);
        break;
      case "scroll":
        options.scroll = coerceBoolean(nextValue, true);
        break;
      case "expand":
        options.expand = coerceBoolean(nextValue, true);
        break;
      case "network-bodies":
        options.networkBodies = coerceBoolean(nextValue, true);
        break;
      case "max-json-body-bytes":
        options.maxJsonBodyBytes = coerceNumber(nextValue, options.maxJsonBodyBytes);
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  return options;
}

async function writeFile(targetPath, content) {
  const absolutePath = path.resolve(process.cwd(), targetPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    printHelp();
    return;
  }

  if (!options.url) {
    throw new Error("Missing URL. Pass it as the first argument or with --url.");
  }

  const normalizedUrl = normalizeTargetUrl(options.url);

  const result = await scrapeUrl(normalizedUrl, {
    waitUntil: options.waitUntil,
    timeout: options.timeout,
    delay: options.delay,
    headless: options.headless,
    autoScroll: options.scroll,
    expandContent: options.expand,
    captureJsonResponseBodies: options.networkBodies,
    maxJsonBodyBytes: options.maxJsonBodyBytes,
    includeHtml: Boolean(options.html),
    includeScreenshot: Boolean(options.screenshot)
  });

  const jsonOutput = JSON.stringify(result, null, 2);

  if (options.out) {
    await writeFile(options.out, jsonOutput);
    process.stderr.write(`Saved JSON to ${path.resolve(process.cwd(), options.out)}\n`);
  } else {
    process.stdout.write(`${jsonOutput}\n`);
  }

  if (options.html && result.artifacts.html) {
    await writeFile(options.html, result.artifacts.html);
    process.stderr.write(`Saved HTML to ${path.resolve(process.cwd(), options.html)}\n`);
  }

  if (options.screenshot && result.artifacts.screenshotBase64) {
    const absolutePath = path.resolve(process.cwd(), options.screenshot);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from(result.artifacts.screenshotBase64, "base64"));
    process.stderr.write(`Saved screenshot to ${absolutePath}\n`);
  }
}

function isDirectRun() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  runCli().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
