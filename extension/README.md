# EZPayouts Chart Skins

A Chrome extension that puts EZPayouts' liquid chrome (or Sakura, Twinkle,
Matrix, Black Hole, Embers, a video, or your own clip) behind your
TradingView charts. Candles, wicks, indicators,
drawings and labels stay on top; turning it off brings back the chart's
own background.

Works in Chrome, Brave, Edge, Arc and Opera.

## Install (before it's on the Chrome Web Store)

Step-by-step with pictures: https://ezpayouts.xyz/skins/

1. Download `ezpayouts-chart-skins.zip` from that page and unzip it.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the folder.
4. Pin **EZPayouts Chart Skins** from the puzzle-piece menu, then open a
   chart on tradingview.com.

## Using it

- **Skins:** Animated: Liquid Chrome (same as the site's background),
  Sakura, Twinkle, Matrix, Black Hole and Embers, all drawn live. Videos:
  the EZPayouts video templates. Or **Upload your own** (MP4, WebM, MOV,
  GIF, PNG, JPG); your own file stays on your computer.
- **Strength:** how much skin vs. the chart's own background color.
- **Dim:** darkens the skin so candles stand out. **Blur** softens it.
  **Speed** changes how fast it moves.
- **Frame rate:** 30 fps by default, 60 for smoother motion. Motion pauses
  when the tab is in the background.
- **Alt+Shift+B** turns it on or off (change it at
  `chrome://extensions/shortcuts`).
- Looks best with TradingView's dark theme.

### Other sites

Brokers and prop firms that use TradingView's charts: open the site, click
the extension, then **Turn on here**. Chrome asks for access to that one
site; say no and it still works until you leave the page. Some firms don't
allow browser extensions on evaluation or funded accounts. Check first.

## What it touches

It only changes how the chart looks. On chart pages it skips the one fill
the chart uses to paint its background, so the skin behind shows through.
It doesn't read your symbols, orders or account. The video skins stream
from ezpayouts.xyz.

## Files

- `content/page-hook.js`: runs in the page; makes the chart background clear.
- `content/skin-host.js`: finds the chart and places the skin behind it.
- `skin/`: the skin itself (an extension page in an iframe).
- `shared/chrome-gl.js`: the liquid chrome shader, copied from the site's
  `nav.js`. Keep the two in step.
- `shared/scenes.js`: the animated scenes (Sakura, Twinkle, Matrix, Black
  Hole, Embers). The download page uses it too, for its live previews.
- `shared/skins.js`: the skin list and saved settings.
- `popup/`: the toolbar popup (also the options page).
- `background.js`: the shortcut and other-site access.

## Updating the download

After changing anything in this folder, rebuild the zip that
ezpayouts.xyz/skins/ serves, and bump `version` in `manifest.json`:

    python3 tools/build-extension-zip.py

For the Chrome Web Store, upload the store build instead. It's the same
extension without the video skins (clips from films and shows):

    python3 tools/build-extension-zip.py --store   # -> dist/ezpayouts-chart-skins-store.zip
