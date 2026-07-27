const button = document.querySelector("#capture");
const status = document.querySelector("#status");
const pageDownsInput = document.querySelector("#page-downs");

chrome.storage.local.get({ pageDowns: 3 }).then(({ pageDowns }) => {
  pageDownsInput.value = pageDowns;
});

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Finding deck columns…";

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let tab = activeTab;
    if (!tab?.url?.startsWith("https://pro.x.com/")) {
      const deckTabs = await chrome.tabs.query({
        currentWindow: true,
        url: "https://pro.x.com/*"
      });
      tab = deckTabs.find((candidate) => candidate.url?.includes("/i/decks/")) || deckTabs[0];
    }
    if (!tab?.id) {
      throw new Error("Open an X Pro deck in this Chrome window first.");
    }

    const pageDowns = Math.max(
      0,
      Math.min(100, Math.floor(Number(pageDownsInput.value) || 0))
    );
    pageDownsInput.value = pageDowns;
    await chrome.storage.local.set({ pageDowns });
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });

    const result = await chrome.runtime.sendMessage({
      type: "CAPTURE_DECK",
      tabId: tab.id,
      pageDowns
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Capture failed.");
    }

    status.textContent = `Done — downloaded ${result.files} PNG file${result.files === 1 ? "" : "s"}.`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
