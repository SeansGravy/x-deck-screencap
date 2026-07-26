const button = document.querySelector("#capture");
const status = document.querySelector("#status");

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Finding deck columns…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith("https://pro.x.com/")) {
      throw new Error("Open an X Pro deck in the active tab first.");
    }

    const result = await chrome.runtime.sendMessage({
      type: "CAPTURE_DECK",
      tabId: tab.id
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
