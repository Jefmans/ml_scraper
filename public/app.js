const form = document.querySelector("#scrape-form");
const submitButton = document.querySelector("#submitButton");
const downloadButton = document.querySelector("#downloadButton");
const statusLine = document.querySelector("#statusLine");
const resultJson = document.querySelector("#resultJson");
const urlInput = document.querySelector("#url");
const waitUntilInput = document.querySelector("#waitUntil");
const delayInput = document.querySelector("#delay");
const timeoutInput = document.querySelector("#timeout");
const scrollInput = document.querySelector("#scroll");
const expandInput = document.querySelector("#expand");
const networkBodiesInput = document.querySelector("#networkBodies");
const includeHtmlInput = document.querySelector("#includeHtml");
const includeScreenshotInput = document.querySelector("#includeScreenshot");
const metricStatus = document.querySelector("#metricStatus");
const metricTitle = document.querySelector("#metricTitle");
const metricWords = document.querySelector("#metricWords");
const metricLinks = document.querySelector("#metricLinks");
const finalUrl = document.querySelector("#finalUrl");
const lastError = document.querySelector("#lastError");
const historyList = document.querySelector("#historyList");
const clearHistoryButton = document.querySelector("#clearHistoryButton");

const HISTORY_KEY = "field-scraper.history.v1";
const MAX_HISTORY_ENTRIES = 12;
let latestResult = null;
let selectedHistoryId = null;
let scrapeHistory = loadHistory();

function normalizeUrl(value) {
  const rawValue = value.trim();
  if (!rawValue) {
    throw new Error("Enter a URL.");
  }

  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawValue) ? rawValue : `https://${rawValue}`;
}

function updateMetrics(result) {
  metricStatus.textContent = result.request?.status ?? "n/a";
  metricTitle.textContent = result.page?.title || "Untitled page";
  metricWords.textContent = Intl.NumberFormat().format(result.page?.wordCount ?? 0);
  metricLinks.textContent = Intl.NumberFormat().format(result.links?.length ?? 0);
  finalUrl.textContent = result.request?.finalUrl || result.page?.url || "No final URL";
  lastError.textContent = "None";
}

function setWorkingState(isWorking, message) {
  submitButton.disabled = isWorking;
  statusLine.textContent = message;
}

function truncateText(value, maxLength) {
  if (typeof value !== "string") {
    return value;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function limitArray(items, maxLength) {
  return Array.isArray(items) ? items.slice(0, maxLength) : [];
}

function createHistoryPreview(result, payload) {
  const page = result.page || {};
  const { bodyText, ...restOfPage } = page;

  return {
    history: {
      source: "local-history-preview",
      savedAt: new Date().toISOString(),
      originalOptions: payload
    },
    request: result.request,
    page: {
      ...restOfPage,
      bodyTextPreview: truncateText(bodyText || "", 1600),
      bodyTextTruncated: typeof bodyText === "string" && bodyText.length > 1600
    },
    social: result.social,
    metaTags: limitArray(result.metaTags, 20),
    headings: limitArray(result.headings, 12),
    textBlocks: limitArray(result.textBlocks, 18).map((item) => ({
      ...item,
      text: truncateText(item.text, 400)
    })),
    links: limitArray(result.links, 24),
    images: limitArray(result.images, 16),
    lists: limitArray(result.lists, 10).map((list) => ({
      ...list,
      items: limitArray(list.items, 10)
    })),
    tables: limitArray(result.tables, 5).map((table) => ({
      ...table,
      rows: limitArray(table.rows, 6)
    })),
    forms: limitArray(result.forms, 10),
    buttons: limitArray(result.buttons, 20),
    jsonLd: limitArray(result.jsonLd, 10),
    network: {
      requestCount: result.network?.requests?.length ?? 0,
      jsonResponseCount: result.network?.jsonResponses?.length ?? 0
    },
    artifacts: {
      htmlIncluded: Boolean(result.artifacts?.html),
      screenshotIncluded: Boolean(result.artifacts?.screenshotBase64)
    }
  };
}

function createHistoryEntry(result, payload) {
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `history-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    inputUrl: payload.url,
    finalUrl: result.request?.finalUrl || payload.url,
    title: result.page?.title || "Untitled page",
    status: result.request?.status ?? "n/a",
    durationMs: result.request?.durationMs ?? 0,
    wordCount: result.page?.wordCount ?? 0,
    linkCount: result.links?.length ?? 0,
    payload,
    preview: createHistoryPreview(result, payload)
  };
}

function loadHistory() {
  try {
    const rawValue = localStorage.getItem(HISTORY_KEY);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(scrapeHistory.slice(0, MAX_HISTORY_ENTRIES)));
    return true;
  } catch {
    return false;
  }
}

function setFormValues(payload) {
  urlInput.value = payload.url || "";
  waitUntilInput.value = payload.waitUntil || "networkidle";
  delayInput.value = String(payload.delay ?? 1000);
  timeoutInput.value = String(payload.timeout ?? 45000);
  scrollInput.checked = payload.scroll !== false;
  expandInput.checked = payload.expand !== false;
  networkBodiesInput.checked = payload.networkBodies !== false;
  includeHtmlInput.checked = Boolean(payload.includeHtml);
  includeScreenshotInput.checked = Boolean(payload.includeScreenshot);
}

function formatDateTime(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function selectHistoryEntry(entry, { applyPayload = false } = {}) {
  selectedHistoryId = entry.id;
  latestResult = entry.preview;
  resultJson.value = JSON.stringify(entry.preview, null, 2);
  metricStatus.textContent = entry.status;
  metricTitle.textContent = entry.title;
  metricWords.textContent = Intl.NumberFormat().format(entry.wordCount);
  metricLinks.textContent = Intl.NumberFormat().format(entry.linkCount);
  finalUrl.textContent = entry.finalUrl;
  lastError.textContent = "None";
  downloadButton.disabled = false;

  if (applyPayload) {
    setFormValues(entry.payload);
    statusLine.textContent = `Loaded ${entry.inputUrl} back into the form.`;
  } else {
    statusLine.textContent = `Loaded history preview from ${formatDateTime(entry.createdAt)}.`;
  }

  renderHistory();
}

function renderHistory() {
  historyList.replaceChildren();

  if (scrapeHistory.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "history-empty";
    emptyState.textContent = "No scrape history yet.";
    historyList.append(emptyState);
    clearHistoryButton.disabled = true;
    return;
  }

  clearHistoryButton.disabled = false;

  for (const entry of scrapeHistory) {
    const article = document.createElement("article");
    article.className = `history-item${entry.id === selectedHistoryId ? " active" : ""}`;

    const meta = document.createElement("div");
    meta.className = "history-meta";

    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = formatDateTime(entry.createdAt);

    const status = document.createElement("span");
    status.className = "history-status";
    status.textContent = `${entry.status}`;

    meta.append(time, status);

    const title = document.createElement("h3");
    title.className = "history-title";
    title.textContent = entry.title;

    const url = document.createElement("p");
    url.className = "history-url";
    url.textContent = entry.inputUrl;

    const stats = document.createElement("div");
    stats.className = "history-stats";

    const duration = document.createElement("span");
    duration.textContent = `${entry.durationMs} ms`;
    const words = document.createElement("span");
    words.textContent = `${Intl.NumberFormat().format(entry.wordCount)} words`;
    const links = document.createElement("span");
    links.textContent = `${Intl.NumberFormat().format(entry.linkCount)} links`;

    stats.append(duration, words, links);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const viewButton = document.createElement("button");
    viewButton.type = "button";
    viewButton.className = "ghost";
    viewButton.textContent = "View preview";
    viewButton.addEventListener("click", () => {
      selectHistoryEntry(entry);
    });

    const reuseButton = document.createElement("button");
    reuseButton.type = "button";
    reuseButton.className = "primary";
    reuseButton.textContent = "Reuse URL";
    reuseButton.addEventListener("click", () => {
      selectHistoryEntry(entry, { applyPayload: true });
    });

    actions.append(viewButton, reuseButton);
    article.append(meta, title, url, stats, actions);
    historyList.append(article);
  }
}

function downloadJson() {
  if (!latestResult) {
    return;
  }

  const blob = new Blob([JSON.stringify(latestResult, null, 2)], { type: "application/json" });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = "scrape-result.json";
  anchor.click();
  URL.revokeObjectURL(downloadUrl);
}

function buildPayload() {
  const formData = new FormData(form);
  return {
    url: normalizeUrl(String(formData.get("url") || "")),
    waitUntil: String(formData.get("waitUntil") || "networkidle"),
    delay: Number(formData.get("delay") || 1000),
    timeout: Number(formData.get("timeout") || 45000),
    scroll: scrollInput.checked,
    expand: expandInput.checked,
    networkBodies: networkBodiesInput.checked,
    includeHtml: includeHtmlInput.checked,
    includeScreenshot: includeScreenshotInput.checked
  };
}

async function handleSubmit(event) {
  event.preventDefault();

  try {
    const payload = buildPayload();
    setWorkingState(true, "Rendering page and extracting content...");
    lastError.textContent = "None";

    const response = await fetch("/api/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Scrape failed.");
    }

    latestResult = result;
    selectedHistoryId = null;
    resultJson.value = JSON.stringify(result, null, 2);
    updateMetrics(result);
    downloadButton.disabled = false;
    const historyEntry = createHistoryEntry(result, payload);
    selectedHistoryId = historyEntry.id;
    scrapeHistory = [historyEntry, ...scrapeHistory].slice(0, MAX_HISTORY_ENTRIES);
    const historySaved = saveHistory();
    renderHistory();
    setWorkingState(
      false,
      historySaved
        ? `Completed in ${result.request?.durationMs ?? 0} ms.`
        : `Completed in ${result.request?.durationMs ?? 0} ms, but history could not be saved.`
    );
  } catch (error) {
    latestResult = null;
    selectedHistoryId = null;
    downloadButton.disabled = true;
    resultJson.value = "";
    metricStatus.textContent = "error";
    metricTitle.textContent = "Scrape failed";
    metricWords.textContent = "0";
    metricLinks.textContent = "0";
    finalUrl.textContent = "No final URL";
    lastError.textContent = error.message;
    setWorkingState(false, error.message);
  }
}

form.addEventListener("submit", handleSubmit);
downloadButton.addEventListener("click", downloadJson);
clearHistoryButton.addEventListener("click", () => {
  scrapeHistory = [];
  selectedHistoryId = null;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  statusLine.textContent = "History cleared.";
});

renderHistory();
