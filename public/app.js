const form = document.querySelector("#scrape-form");
const submitButton = document.querySelector("#submitButton");
const downloadButton = document.querySelector("#downloadButton");
const statusLine = document.querySelector("#statusLine");
const resultJson = document.querySelector("#resultJson");
const metricStatus = document.querySelector("#metricStatus");
const metricTitle = document.querySelector("#metricTitle");
const metricWords = document.querySelector("#metricWords");
const metricLinks = document.querySelector("#metricLinks");
const finalUrl = document.querySelector("#finalUrl");
const lastError = document.querySelector("#lastError");

let latestResult = null;

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
    scroll: document.querySelector("#scroll").checked,
    expand: document.querySelector("#expand").checked,
    networkBodies: document.querySelector("#networkBodies").checked,
    includeHtml: document.querySelector("#includeHtml").checked,
    includeScreenshot: document.querySelector("#includeScreenshot").checked
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
    resultJson.value = JSON.stringify(result, null, 2);
    updateMetrics(result);
    downloadButton.disabled = false;
    setWorkingState(false, `Completed in ${result.request?.durationMs ?? 0} ms.`);
  } catch (error) {
    latestResult = null;
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
