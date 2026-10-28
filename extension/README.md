# EZPayouts (extension)

Two sides, picked at the top of the popup: **Chart Skins** and **Risk
Management**.

## Chart Skins

A Chrome extension that puts EZPayouts' liquid chrome (or Sakura, Twinkle,
Matrix, Black Hole, Embers, or your own clip) behind your
TradingView charts, and can restyle the chart's order and position tags.
Candles, wicks, indicators, drawings and labels stay on top; turning it
off brings back the chart's own background. The wallpaper and the tags
each have their own switch.

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
  Sakura, Twinkle, Matrix, Black Hole and Embers, all drawn live. Or
  **Upload your own** (MP4, WebM, MOV, GIF, PNG, JPG); your own file stays
  on your computer.
- **Strength:** how much skin vs. the chart's own background color.
- **Dim:** darkens the skin so candles stand out. **Blur** softens it.
  **Speed** changes how fast it moves.
- **Frame rate:** 30 fps by default, 60 for smoother motion. Motion pauses
  when the tab is in the background.
- **Order tags** (the second card in the popup): restyles the Buy and Sell
  limit and stop tags, your open position and its P&L, the TP and SL
  buttons and lines, a new order's place button, a moved order's Confirm
  and Discard, the add-order (+) button, and their lines. Pick a
  color set (or Match wallpaper) and a style. **Modern** (a glass ticket
  with a color block) and **Frosted Glass** (blurred pills with a glowing
  underline) redraw the tags from scratch, and every price box on the
  price scale too (orders and the position with a dot, the rest with
  their own color); Outline, Filled, Glow and Minimal recolor
  TradingView's own. On or off on its own, with or without the wallpaper.
- **Position** (the third card): themes TradingView's Long Position and
  Short Position tools: a rounded frame glowing in the theme's color, the
  target lit in it, the stop a dark tint of it, a dashed entry line, and
  pill labels (the target's filled, the entry's outlined, the stop's dim). Starry
  Space, Ember & Ash, Black Hole, Silk & Satin, Matrix or Sakura, or Match
  wallpaper. On or off on its own.
- **Alt+Shift+B** turns the wallpaper on or off (change it at
  `chrome://extensions/shortcuts`).
- Looks best with TradingView's dark theme.

### Free and Pro

Free: the Sakura wallpaper, and Outline order tags in the EZ or Sakura
colors. **EZPayouts Pro** ($9.99 a month or $79.99 a year, at
https://ezpayouts.xyz/pro/) unlocks every wallpaper, your own upload, every
tag look and color, and the Position themes. Everything can be picked and
previewed in the popup (marked PRO); only what your plan covers goes on the
chart (`EZSkins.applied`). The popup's **Go Pro** button opens the Pro page
with this extension's id; once you're signed in there, the page hands the
extension your EZPayouts session (`externally_connectable`), and the
background worker checks `/billing/status` on the account server now and
then. Payments are Stripe Checkout and Stripe's customer portal, run by the
account worker (`worker/auth`, see its `wrangler.toml`).

### Risk Management (on TradingView)

The popup's second side. With your broker connected on TradingView and its
trading panel showing, `content/risk-guard.js` reads the account from the
panel by label: the fields along its top and the Account Summary table
(balance, equity, and the broker's P/L: a day P/L if there is one, else
realized plus open, else total P/L), Positions (the open position and its
profit) and Orders (fills). Today started at equity minus today's P/L. If
the broker shows no P/L at all, it counts from the balance it first sees
each day ("Restart count" starts over from now). Sessions start 6 PM New
York. Limits: daily/weekly loss, daily/weekly profit
target, max quantity per trade, and how long a lock lasts (4 hours unless
changed). When a limit is hit, or you press **Lock now** for a number of
hours, it closes open positions and cancels working orders with
TradingView's own close buttons (confirming the dialog), keeps doing so
while locked, covers the order panel and the chart's Buy/Sell buttons,
and blocks order buttons. An order bigger than the max quantity is
blocked with a warning. "Prevent changes while trading is locked" freezes
the settings (and the on/off switch) until the lock ends. It only acts on
TradingView in this browser; trades placed elsewhere aren't covered.
Settings: `ezRisk`; lock and day/week starting balances: `ezRiskState`;
what it sees, for the popup: `ezRiskLive`.

### Other sites

Brokers and prop firms that use TradingView's charts: open the site, click
the extension, then **Turn on here**. Chrome asks for access to that one
site; say no and it still works until you leave the page. Some firms don't
allow browser extensions on evaluation or funded accounts. Check first.

## What it touches

It only changes how the chart looks. On chart pages it skips the one fill
the chart uses to paint its background, so the skin behind shows through.
With order tags on, it swaps the colors the chart draws its tags in as
they're drawn, or, for Modern and Frosted Glass, draws them itself in the
same spot. It doesn't read your symbols, orders or account. Signed in for
Pro, it asks the EZPayouts account server whether Pro is active, and
nothing else.

## Files

- `content/page-hook.js`: runs in the page; makes the chart background
  clear and recolors the order tags.
- `content/skin-host.js`: finds the chart and places the skin behind it.
- `skin/`: the skin itself (an extension page in an iframe).
- `shared/chrome-gl.js`: the liquid chrome shader, copied from the site's
  `nav.js`. Keep the two in step.
- `shared/scenes.js`: the animated scenes (Sakura, Twinkle, Matrix, Black
  Hole, Embers). The download page uses it too, for its live previews.
- `shared/skins.js`: the skin list and saved settings.
- `popup/`: the toolbar popup (also the options page).
- `background.js`: the shortcut, other-site access and the Pro check.
- `content/risk-guard.js`, `popup/risk.js`: Risk Management (see above).

## Updating the download

After changing anything in this folder, rebuild the zip that
ezpayouts.xyz/skins/ serves, and bump `version` in `manifest.json`:

    python3 tools/build-extension-zip.py

For the Chrome Web Store, upload the store build instead (the same
extension, without this README):

    python3 tools/build-extension-zip.py --store   # -> dist/ezpayouts-chart-skins-store.zip
