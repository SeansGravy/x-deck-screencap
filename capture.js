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
        element.querySelector('[data-testid="cellInnerDiv"]') !== null &&
        element.scrollHeight > element.clientHeight + 32 &&
        rect.width >= 100 &&
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
    // captureVisibleTab is limited to two calls per second.
    await sleep(600);
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

    if (message.type === "SCROLL_COLUMNS_TO_PAGE") {
      const columns = globalThis.__xDeckScreencapColumns || [];
      for (const column of columns) {
        if (!column.element?.isConnected) continue;
        column.element.scrollTop = Math.min(
          message.page * column.element.clientHeight,
          column.element.scrollHeight - column.element.clientHeight
        );
      }
      waitForPaint().then(() => sendResponse({
        ok: true,
        atEnd: columns.every(
          (column) =>
            !column.element?.isConnected ||
            column.element.scrollTop >=
              column.element.scrollHeight - column.element.clientHeight - 1
        )
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
