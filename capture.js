(() => {
  if (globalThis.__xDeckScreencapInstalled) return;
  globalThis.__xDeckScreencapInstalled = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function visibleRect(element) {
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(innerWidth, rect.right);
    const bottom = Math.min(innerHeight, rect.bottom);
    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top)
    };
  }

  function findColumns() {
    const candidates = [...document.querySelectorAll("div")].filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        ["auto", "scroll"].includes(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 32 &&
        rect.width >= 240 &&
        rect.height >= Math.min(360, innerHeight * 0.5) &&
        rect.right > 0 &&
        rect.left < innerWidth
      );
    });

    const leafScrollers = candidates.filter(
      (element) => !candidates.some((other) => other !== element && element.contains(other))
    );

    return leafScrollers
      .map((element, index) => ({
        element,
        sourceIndex: index,
        rect: visibleRect(element),
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        originalScrollTop: element.scrollTop
      }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => a.rect.x - b.rect.x)
      .map((column, index) => ({ ...column, index }));
  }

  async function waitForPaint() {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await sleep(350);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "DISCOVER_COLUMNS") {
      const columns = findColumns();
      globalThis.__xDeckScreencapColumns = columns;
      sendResponse({
        columns: columns.map(({ index, rect, scrollHeight, clientHeight }) => ({
          index,
          rect,
          scrollHeight,
          clientHeight
        }))
      });
      return;
    }

    if (message.type === "SCROLL_COLUMN") {
      const column = globalThis.__xDeckScreencapColumns?.[message.index];
      if (!column?.element?.isConnected) {
        sendResponse({ ok: false });
        return;
      }
      column.element.scrollTop = message.top;
      waitForPaint().then(() => sendResponse({
        ok: true,
        actualTop: column.element.scrollTop,
        rect: visibleRect(column.element),
        scrollHeight: column.element.scrollHeight
      }));
      return true;
    }

    if (message.type === "RESTORE_COLUMNS") {
      for (const column of globalThis.__xDeckScreencapColumns || []) {
        if (column.element?.isConnected) column.element.scrollTop = column.originalScrollTop;
      }
      sendResponse({ ok: true });
    }
  });
})();
