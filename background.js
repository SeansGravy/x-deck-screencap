const DEBUGGER_VERSION = "1.3";
const MAX_CANVAS_HEIGHT = 30000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "CAPTURE_DECK") return;
  captureDeck(message.tabId, message.pageDowns)
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

function scrollStops(scrollHeight, viewportHeight, pageDowns) {
  const max = Math.max(0, scrollHeight - viewportHeight);
  const limit = Math.min(max, viewportHeight * pageDowns);
  const stops = [0];
  for (let top = viewportHeight; top <= limit; top += viewportHeight) stops.push(top);
  if (stops.at(-1) !== limit) stops.push(limit);
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

async function captureColumn(tabId, target, column, pageDowns) {
  const stops = scrollStops(column.scrollHeight, column.clientHeight, pageDowns);
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

  return {
    width: column.rect.width,
    height: totalHeight,
    parts
  };
}

async function downloadCollage(columns, stamp) {
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  const height = Math.max(...columns.map((column) => column.height));
  if (width > MAX_CANVAS_HEIGHT) {
    throw new Error("The deck is too wide to combine into a Chrome canvas.");
  }

  let fileCount = 0;
  let sliceTop = 0;
  while (sliceTop < height) {
    const sliceHeight = Math.min(MAX_CANVAS_HEIGHT, height - sliceTop);
    const canvas = new OffscreenCanvas(width, sliceHeight);
    const context = canvas.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, sliceHeight);

    let columnX = 0;
    for (const column of columns) {
      let partTop = 0;
      for (const part of column.parts) {
        const partBottom = partTop + part.drawHeight;
        if (partBottom > sliceTop && partTop < sliceTop + sliceHeight) {
          context.drawImage(
            part.bitmap,
            0,
            part.sourceY,
            part.bitmap.width,
            part.drawHeight,
            columnX,
            partTop - sliceTop,
            column.width,
            part.drawHeight
          );
        }
        partTop = partBottom;
      }
      columnX += column.width;
    }

    const partNumber = Math.floor(sliceTop / MAX_CANVAS_HEIGHT) + 1;
    const suffix = height > MAX_CANVAS_HEIGHT ? `-part-${partNumber}` : "";
    await downloadCanvas(canvas, `x-deck-screencap/${stamp}-collage${suffix}.png`);
    sliceTop += sliceHeight;
    fileCount += 1;
  }

  for (const column of columns) {
    for (const part of column.parts) part.bitmap.close();
  }
  return fileCount;
}

async function captureDeck(tabId, requestedPageDowns) {
  const target = { tabId };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const pageDowns = Math.max(0, Math.min(100, Math.floor(Number(requestedPageDowns) || 0)));
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

    const columns = [];
    for (let index = 0; index < discovery.columns.length; index += 1) {
      columns.push(await captureColumn(
        tabId,
        target,
        discovery.columns[index],
        pageDowns
      ));
    }
    return downloadCollage(columns, stamp);
  } finally {
    await sendToTab(tabId, { type: "RESTORE_COLUMNS" }).catch(() => {});
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}
