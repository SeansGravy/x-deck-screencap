const DEBUGGER_VERSION = "1.3";
const MAX_CANVAS_HEIGHT = 30000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "CAPTURE_DECK") return;
  captureDeck(message.tabId)
    .then((files) => sendResponse({ ok: true, files }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

function debuggerCommand(target, method, params = {}) {
  return chrome.debugger.sendCommand(target, method, params);
}

function dataUrlToBlob(dataUrl) {
  const [metadata, encoded] = dataUrl.split(",");
  const type = metadata.match(/data:(.*?);/)?.[1] || "image/png";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type });
}

async function screenshot(target, rect) {
  const result = await debuggerCommand(target, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      scale: 1
    }
  });
  return createImageBitmap(dataUrlToBlob(`data:image/png;base64,${result.data}`));
}

function scrollStops(scrollHeight, viewportHeight) {
  const max = Math.max(0, scrollHeight - viewportHeight);
  const stops = [];
  for (let top = 0; top < max; top += viewportHeight) stops.push(top);
  if (!stops.length || stops.at(-1) !== max) stops.push(max);
  return stops;
}

async function canvasDataUrl(canvas) {
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

async function downloadCanvas(canvas, filename) {
  const url = await canvasDataUrl(canvas);
  await chrome.downloads.download({ url, filename, saveAs: false });
}

async function captureColumn(tabId, target, column, columnNumber, stamp) {
  const stops = scrollStops(column.scrollHeight, column.clientHeight);
  const parts = [];
  let totalHeight = 0;
  let previousTop = 0;

  for (let i = 0; i < stops.length; i += 1) {
    const result = await sendToTab(tabId, {
      type: "SCROLL_COLUMN",
      index: column.index,
      top: stops[i]
    });
    if (!result?.ok) throw new Error(`Column ${columnNumber} changed during capture.`);

    const bitmap = await screenshot(target, result.rect);
    const drawHeight = i === 0
      ? bitmap.height
      : Math.min(bitmap.height, Math.max(0, result.actualTop - previousTop));
    const sourceY = i === 0 ? 0 : Math.max(0, bitmap.height - drawHeight);
    parts.push({ bitmap, sourceY, drawHeight });
    totalHeight += drawHeight;
    previousTop = result.actualTop;
  }

  let fileCount = 0;
  let partNumber = 1;
  let cursor = 0;
  while (cursor < totalHeight) {
    const partHeight = Math.min(MAX_CANVAS_HEIGHT, totalHeight - cursor);
    const canvas = new OffscreenCanvas(column.rect.width, partHeight);
    const context = canvas.getContext("2d");
    let sourceCursor = 0;
    let destinationY = -cursor;

    for (const part of parts) {
      if (sourceCursor + part.drawHeight > cursor && destinationY < partHeight) {
        context.drawImage(
          part.bitmap,
          0,
          part.sourceY,
          part.bitmap.width,
          part.drawHeight,
          0,
          destinationY,
          column.rect.width,
          part.drawHeight
        );
      }
      sourceCursor += part.drawHeight;
      destinationY += part.drawHeight;
    }

    const suffix = totalHeight > MAX_CANVAS_HEIGHT ? `-part-${partNumber}` : "";
    await downloadCanvas(
      canvas,
      `x-deck-screencap/${stamp}-column-${String(columnNumber).padStart(2, "0")}${suffix}.png`
    );
    cursor += partHeight;
    partNumber += 1;
    fileCount += 1;
  }

  for (const part of parts) part.bitmap.close();
  return fileCount;
}

async function captureDeck(tabId) {
  const target = { tabId };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let attached = false;

  try {
    let discovery;
    try {
      discovery = await sendToTab(tabId, { type: "DISCOVER_COLUMNS" });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["capture.js"] });
      discovery = await sendToTab(tabId, { type: "DISCOVER_COLUMNS" });
    }

    if (!discovery?.columns?.length) {
      throw new Error("No scrollable X Pro columns were found. Wait for the deck to load and try again.");
    }

    await chrome.debugger.attach(target, DEBUGGER_VERSION);
    attached = true;
    await debuggerCommand(target, "Page.enable");

    let files = 0;
    for (let index = 0; index < discovery.columns.length; index += 1) {
      files += await captureColumn(
        tabId,
        target,
        discovery.columns[index],
        index + 1,
        stamp
      );
    }
    return files;
  } finally {
    await sendToTab(tabId, { type: "RESTORE_COLUMNS" }).catch(() => {});
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}
