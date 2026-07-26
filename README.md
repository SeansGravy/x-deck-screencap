# X Deck Screencap

A local-first Chrome extension that captures every independently scrollable column in an
[X Pro](https://pro.x.com/) deck—including content below the fold.

It was designed for decks such as:

`https://pro.x.com/i/decks/2080681249115390305`

## Install

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this repository's folder.
5. Open the X Pro deck and wait for its columns to finish loading.
6. Choose how many page downs to capture per column (the default is `3`).
7. Click **Capture deck collage**.

A side-by-side PNG collage is downloaded into an `x-deck-screencap` folder. Each deck
column contains the initial viewport plus the configured number of page downs. The
extension remembers the setting for the next capture. Use `0` to capture only the
currently visible viewport. Captures taller than Chrome's canvas limit are split into
numbered collage parts.

## How it works

X Pro uses independently scrolling, dynamically rendered columns, so Chrome's ordinary
full-page screenshot does not include everything below each column's fold. This
extension:

1. discovers the visible deck's scrollable column containers;
2. scrolls each one from top to bottom;
3. captures its visible tiles through the Chrome DevTools protocol;
4. stitches the tiles into one side-by-side collage; and
5. restores every column to its original scroll position.

The tab must remain visible while capture runs so X Pro continues rendering its
virtualized timeline rows.

## Privacy

All capture and image stitching happens locally in Chrome. The extension does not send
page content or screenshots to a server. Its host access is limited to `pro.x.com`.

## Limitations

- X can change its DOM or rendering behavior at any time.
- Lazy-loaded posts require a stable network connection while the extension scrolls.
- Protected or unavailable posts cannot be captured.
- A capture reflects the deck at capture time; live timelines may receive new posts
  while the process is running.

## Development

The project has no build step or third-party runtime dependencies. After editing, click
the extension's reload button on `chrome://extensions`.

## License

[MIT](LICENSE)
