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

function dataUrlToBlob(dataUrl) {
  const [metadata, encoded] = dataUrl.split(",");
  const type = metadata.match(/data:(.*?);/)?.[1] || "image/png";
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type });
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

async function captureVisibleFrame(windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  return createImageBitmap(dataUrlToBlob(dataUrl));
}

async function downloadCollage(frames, stamp) {
  const width = frames[0].width;
  const totalHeight = frames.reduce((sum, frame) => sum + frame.height, 0);
  let fileCount = 0;
  let sliceTop = 0;

  while (sliceTop < totalHeight) {
    const sliceHeight = Math.min(MAX_CANVAS_HEIGHT, totalHeight - sliceTop);
    const canvas = new OffscreenCanvas(width, sliceHeight);
    const context = canvas.getContext("2d");
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, sliceHeight);

    let frameTop = 0;
    for (const frame of frames) {
      const frameBottom = frameTop + frame.height;
      if (frameBottom > sliceTop && frameTop < sliceTop + sliceHeight) {
        context.drawImage(frame, 0, frameTop - sliceTop);
      }
      frameTop = frameBottom;
    }

    const partNumber = Math.floor(sliceTop / MAX_CANVAS_HEIGHT) + 1;
    const suffix = totalHeight > MAX_CANVAS_HEIGHT ? `-part-${partNumber}` : "";
    await downloadCanvas(canvas, `x-deck-screencap/${stamp}-collage${suffix}.png`);
    sliceTop += sliceHeight;
    fileCount += 1;
  }

  for (const frame of frames) frame.close();
  return fileCount;
}

async function captureDeck(tabId, requestedPageDowns) {
  const tab = await chrome.tabs.get(tabId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const pageDowns = Math.max(0, Math.min(100, Math.floor(Number(requestedPageDowns) || 0)));

  try {
    let discovery;
    try {
      discovery = await sendToTab(tabId, { type: "DISCOVER_COLUMNS" });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["capture.js"] });
      discovery = await sendToTab(tabId, { type: "DISCOVER_COLUMNS" });
    }

    if (!discovery?.columns?.length) {
      throw new Error("No X Pro timeline columns were found. Wait for the deck to load and try again.");
    }

    const frames = [];
    for (let page = 0; page <= pageDowns; page += 1) {
      const scroll = await sendToTab(tabId, {
        type: "SCROLL_COLUMNS_TO_PAGE",
        page
      });
      frames.push(await captureVisibleFrame(tab.windowId));
      if (scroll.atEnd) break;
    }

    return downloadCollage(frames, stamp);
  } finally {
    await sendToTab(tabId, { type: "RESTORE_COLUMNS" }).catch(() => {});
  }
}
