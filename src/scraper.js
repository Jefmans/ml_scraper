import { chromium } from "playwright";

const NETWORK_RESOURCE_TYPES = new Set(["document", "xhr", "fetch", "script", "stylesheet", "image", "media", "font"]);
const EXPAND_LABEL_PATTERN = /^(show|view|read|see|load|more|expand|details)\b/i;
const CONSENT_LABEL_PATTERN = /\b(accept|agree|allow|consent|got it|ok)\b/i;

function normalizeWaitUntil(waitUntil) {
  const supportedValues = new Set(["load", "domcontentloaded", "networkidle"]);
  if (!supportedValues.has(waitUntil)) {
    throw new Error(`Unsupported wait strategy "${waitUntil}". Use load, domcontentloaded, or networkidle.`);
  }

  return waitUntil;
}

async function launchBrowser(headless) {
  const launchAttempts = [
    { channel: "msedge", headless },
    { channel: "chrome", headless },
    { headless }
  ];

  let lastError;

  for (const options of launchAttempts) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Failed to launch Chromium. Install a compatible browser or run "npx playwright install chromium". Last error: ${lastError?.message ?? "unknown"}`
  );
}

async function dismissCommonOverlays(page) {
  const candidates = [
    "button",
    "[role='button']",
    "a",
    "input[type='button']",
    "input[type='submit']"
  ];

  for (const selector of candidates) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count(), 25);

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);

      try {
        const label = (await item.innerText({ timeout: 500 })).trim();
        if (CONSENT_LABEL_PATTERN.test(label)) {
          await item.click({ timeout: 1_500 });
          await page.waitForTimeout(300);
        }
      } catch {
        // Ignore transient overlay and stale element failures.
      }
    }
  }
}

async function expandCommonContent(page) {
  const selectors = [
    "button",
    "[role='button']",
    "summary",
    "a"
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count(), 40);

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);

      try {
        const label = (await item.innerText({ timeout: 500 })).trim();
        if (!EXPAND_LABEL_PATTERN.test(label)) {
          continue;
        }

        const href = await item.getAttribute("href");
        if (href && href !== "#" && !href.startsWith("javascript:")) {
          continue;
        }

        await item.click({ timeout: 1_500 });
        await page.waitForTimeout(250);
      } catch {
        // Ignore elements that cannot be clicked safely.
      }
    }
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    let previousHeight = -1;
    let stablePasses = 0;

    while (stablePasses < 3) {
      window.scrollTo(0, document.body.scrollHeight);
      await delay(500);

      const currentHeight = document.body.scrollHeight;
      if (currentHeight === previousHeight) {
        stablePasses += 1;
      } else {
        stablePasses = 0;
      }

      previousHeight = currentHeight;
    }

    window.scrollTo(0, 0);
    await delay(200);
  });
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function buildNetworkCollector(options) {
  const requests = [];
  const responseTasks = [];
  const jsonResponseBodies = [];

  const onResponse = async (response) => {
    const request = response.request();
    const resourceType = request.resourceType();

    if (!NETWORK_RESOURCE_TYPES.has(resourceType)) {
      return;
    }

    const headers = await response.allHeaders().catch(() => ({}));
    const contentType = headers["content-type"] ?? "";
    const entry = {
      url: response.url(),
      status: response.status(),
      ok: response.ok(),
      resourceType,
      method: request.method(),
      headers,
      timing: request.timing()
    };

    requests.push(entry);

    const isJsonLike = /application\/(.+\+)?json|text\/json/i.test(contentType);
    if (!options.captureJsonResponseBodies || !isJsonLike || jsonResponseBodies.length >= 50) {
      return;
    }

    responseTasks.push(
      (async () => {
        try {
          const body = await response.text();
          if (Buffer.byteLength(body, "utf8") > options.maxJsonBodyBytes) {
            jsonResponseBodies.push({
              url: response.url(),
              status: response.status(),
              contentType,
              truncated: true,
              sizeBytes: Buffer.byteLength(body, "utf8")
            });
            return;
          }

          jsonResponseBodies.push({
            url: response.url(),
            status: response.status(),
            contentType,
            truncated: false,
            body: safeJsonParse(body)
          });
        } catch {
          jsonResponseBodies.push({
            url: response.url(),
            status: response.status(),
            contentType,
            truncated: true,
            error: "Unable to read response body"
          });
        }
      })()
    );
  };

  return {
    requests,
    jsonResponseBodies,
    responseTasks,
    onResponse
  };
}

function extractPageData() {
  const normalizeText = (value) => (value ?? "").replace(/\s+/g, " ").trim();
  const toAbsoluteUrl = (value) => {
    if (!value) {
      return null;
    }

    try {
      return new URL(value, window.location.href).href;
    } catch {
      return value;
    }
  };

  const buildSelector = (element) => {
    if (!(element instanceof Element)) {
      return null;
    }

    const parts = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += `#${current.id}`;
        parts.unshift(selector);
        break;
      }

      const classList = Array.from(current.classList).slice(0, 2);
      if (classList.length > 0) {
        selector += `.${classList.join(".")}`;
      }

      const siblingIndex = Array.from(current.parentElement?.children ?? []).filter(
        (child) => child.tagName === current.tagName
      ).indexOf(current);

      if (siblingIndex > 0) {
        selector += `:nth-of-type(${siblingIndex + 1})`;
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(" > ");
  };

  const isVisible = (element) => {
    if (!(element instanceof Element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const unique = (items, keyBuilder) => {
    const seen = new Set();
    const result = [];

    for (const item of items) {
      const key = keyBuilder(item);
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(item);
    }

    return result;
  };

  const metaTags = Array.from(document.querySelectorAll("meta")).map((element) => ({
    name: element.getAttribute("name"),
    property: element.getAttribute("property"),
    httpEquiv: element.getAttribute("http-equiv"),
    charset: element.getAttribute("charset"),
    content: element.getAttribute("content")
  }));

  const openGraph = {};
  const twitter = {};

  for (const tag of metaTags) {
    if (tag.property?.startsWith("og:")) {
      openGraph[tag.property] = tag.content;
    }

    if (tag.name?.startsWith("twitter:")) {
      twitter[tag.name] = tag.content;
    }
  }

  const textBlocks = unique(
    Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, code, figcaption, td, th"))
      .filter(isVisible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: normalizeText(element.textContent),
        selector: buildSelector(element)
      }))
      .filter((item) => item.text.length > 0),
    (item) => `${item.tag}:${item.text}`
  );

  const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .filter(isVisible)
    .map((element) => ({
      level: Number(element.tagName.slice(1)),
      text: normalizeText(element.textContent),
      id: element.id || null,
      selector: buildSelector(element)
    }));

  const links = unique(
    Array.from(document.querySelectorAll("a[href]"))
      .map((element) => ({
        text: normalizeText(element.textContent),
        href: toAbsoluteUrl(element.getAttribute("href")),
        title: element.getAttribute("title"),
        rel: element.getAttribute("rel"),
        target: element.getAttribute("target"),
        download: element.hasAttribute("download"),
        selector: buildSelector(element),
        isVisible: isVisible(element)
      }))
      .filter((item) => item.href),
    (item) => `${item.href}:${item.text}`
  );

  const images = unique(
    Array.from(document.images).map((element) => ({
      src: element.currentSrc || toAbsoluteUrl(element.getAttribute("src")),
      alt: normalizeText(element.getAttribute("alt")),
      width: element.naturalWidth || element.width || null,
      height: element.naturalHeight || element.height || null,
      loading: element.getAttribute("loading"),
      srcset: element.getAttribute("srcset"),
      selector: buildSelector(element),
      isVisible: isVisible(element)
    })),
    (item) => item.src
  );

  const lists = Array.from(document.querySelectorAll("ul, ol"))
    .filter(isVisible)
    .map((element) => ({
      type: element.tagName.toLowerCase(),
      items: Array.from(element.querySelectorAll(":scope > li")).map((item) => normalizeText(item.textContent)),
      selector: buildSelector(element)
    }))
    .filter((item) => item.items.length > 0);

  const tables = Array.from(document.querySelectorAll("table"))
    .filter(isVisible)
    .map((table) => {
      const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
        Array.from(row.querySelectorAll("th, td")).map((cell) => normalizeText(cell.textContent))
      );

      return {
        caption: normalizeText(table.querySelector("caption")?.textContent),
        headers: Array.from(table.querySelectorAll("thead th")).map((cell) => normalizeText(cell.textContent)),
        rows,
        selector: buildSelector(table)
      };
    });

  const forms = Array.from(document.querySelectorAll("form")).map((form) => ({
    action: toAbsoluteUrl(form.getAttribute("action")),
    method: (form.getAttribute("method") ?? "get").toLowerCase(),
    selector: buildSelector(form),
    fields: Array.from(form.querySelectorAll("input, textarea, select")).map((field) => ({
      tag: field.tagName.toLowerCase(),
      type: field.getAttribute("type") ?? null,
      name: field.getAttribute("name"),
      id: field.id || null,
      placeholder: field.getAttribute("placeholder"),
      required: field.required,
      disabled: field.disabled,
      label: normalizeText(
        field.labels?.length
          ? Array.from(field.labels)
              .map((label) => label.textContent)
              .join(" ")
          : ""
      )
    }))
  }));

  const buttons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit']"))
    .filter(isVisible)
    .map((element) => ({
      text: normalizeText(element.textContent || element.getAttribute("value")),
      type: element.getAttribute("type"),
      selector: buildSelector(element)
    }))
    .filter((item) => item.text.length > 0);

  const scripts = Array.from(document.scripts).map((script) => ({
    src: toAbsoluteUrl(script.getAttribute("src")),
    type: script.getAttribute("type"),
    async: script.async,
    defer: script.defer,
    textLength: script.src ? 0 : normalizeText(script.textContent).length
  }));

  const stylesheets = Array.from(document.querySelectorAll("link[rel~='stylesheet']")).map((element) => ({
    href: toAbsoluteUrl(element.getAttribute("href")),
    media: element.getAttribute("media")
  }));

  const jsonLd = Array.from(document.querySelectorAll("script[type='application/ld+json']"))
    .map((script) => (script.textContent ?? "").trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    });

  const iframes = Array.from(document.querySelectorAll("iframe")).map((frame) => ({
    src: toAbsoluteUrl(frame.getAttribute("src")),
    title: frame.getAttribute("title"),
    name: frame.getAttribute("name"),
    selector: buildSelector(frame)
  }));

  const videos = Array.from(document.querySelectorAll("video")).map((video) => ({
    poster: toAbsoluteUrl(video.getAttribute("poster")),
    controls: video.controls,
    autoplay: video.autoplay,
    loop: video.loop,
    muted: video.muted,
    sources: Array.from(video.querySelectorAll("source")).map((source) => ({
      src: toAbsoluteUrl(source.getAttribute("src")),
      type: source.getAttribute("type")
    })),
    selector: buildSelector(video)
  }));

  const storage = (() => {
    const readStorage = (storageObject) => {
      try {
        return Object.fromEntries(
          Array.from({ length: storageObject.length }, (_, index) => {
            const key = storageObject.key(index);
            return [key, storageObject.getItem(key)];
          })
        );
      } catch {
        return {};
      }
    };

    return {
      localStorage: readStorage(window.localStorage),
      sessionStorage: readStorage(window.sessionStorage)
    };
  })();

  const bodyText = normalizeText(document.body?.innerText ?? "");

  return {
    page: {
      url: window.location.href,
      title: normalizeText(document.title),
      lang: document.documentElement.lang || null,
      charset: document.characterSet || null,
      canonicalUrl: toAbsoluteUrl(document.querySelector("link[rel='canonical']")?.getAttribute("href")),
      description: document.querySelector("meta[name='description']")?.getAttribute("content") ?? null,
      keywords: document.querySelector("meta[name='keywords']")?.getAttribute("content") ?? null,
      favicon: toAbsoluteUrl(document.querySelector("link[rel~='icon']")?.getAttribute("href")),
      bodyText,
      wordCount: bodyText.length === 0 ? 0 : bodyText.split(/\s+/).length,
      htmlLength: document.documentElement.outerHTML.length
    },
    metaTags,
    social: {
      openGraph,
      twitter
    },
    headings,
    textBlocks,
    links,
    images,
    lists,
    tables,
    forms,
    buttons,
    iframes,
    videos,
    scripts,
    stylesheets,
    jsonLd,
    storage
  };
}

export async function scrapeUrl(url, options = {}) {
  const normalizedOptions = {
    waitUntil: normalizeWaitUntil(options.waitUntil ?? "networkidle"),
    timeout: options.timeout ?? 45_000,
    delay: options.delay ?? 1_000,
    headless: options.headless ?? true,
    autoScroll: options.autoScroll ?? true,
    expandContent: options.expandContent ?? true,
    captureJsonResponseBodies: options.captureJsonResponseBodies ?? true,
    maxJsonBodyBytes: options.maxJsonBodyBytes ?? 200_000,
    includeHtml: options.includeHtml ?? false,
    includeScreenshot: options.includeScreenshot ?? false
  };

  const browser = await launchBrowser(normalizedOptions.headless);

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    const networkCollector = buildNetworkCollector(normalizedOptions);
    page.on("response", networkCollector.onResponse);

    const startedAt = new Date().toISOString();
    const navigationStarted = Date.now();
    const response = await page.goto(url, {
      waitUntil: normalizedOptions.waitUntil,
      timeout: normalizedOptions.timeout
    });

    await dismissCommonOverlays(page);

    if (normalizedOptions.expandContent) {
      await expandCommonContent(page);
    }

    if (normalizedOptions.autoScroll) {
      await autoScroll(page);
    }

    if (normalizedOptions.delay > 0) {
      await page.waitForTimeout(normalizedOptions.delay);
    }

    const extracted = await page.evaluate(extractPageData);
    const cookies = await context.cookies();
    const html = normalizedOptions.includeHtml ? await page.content() : null;
    const screenshotBase64 = normalizedOptions.includeScreenshot
      ? await page.screenshot({ fullPage: true }).then((buffer) => buffer.toString("base64"))
      : null;

    await Promise.allSettled(networkCollector.responseTasks);

    return {
      request: {
        inputUrl: url,
        finalUrl: page.url(),
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - navigationStarted,
        status: response?.status() ?? null,
        ok: response?.ok() ?? null,
        waitUntil: normalizedOptions.waitUntil,
        timeout: normalizedOptions.timeout
      },
      browser: {
        userAgent: await page.evaluate(() => navigator.userAgent),
        viewport: page.viewportSize()
      },
      page: extracted.page,
      metaTags: extracted.metaTags,
      social: extracted.social,
      headings: extracted.headings,
      textBlocks: extracted.textBlocks,
      links: extracted.links,
      images: extracted.images,
      lists: extracted.lists,
      tables: extracted.tables,
      forms: extracted.forms,
      buttons: extracted.buttons,
      iframes: extracted.iframes,
      videos: extracted.videos,
      scripts: extracted.scripts,
      stylesheets: extracted.stylesheets,
      jsonLd: extracted.jsonLd,
      storage: extracted.storage,
      cookies,
      network: {
        requests: networkCollector.requests,
        jsonResponses: networkCollector.jsonResponseBodies
      },
      artifacts: {
        html,
        screenshotBase64
      }
    };
  } finally {
    await browser.close();
  }
}
