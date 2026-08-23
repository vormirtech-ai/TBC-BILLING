# The Baruch Cafe — Billing & POS

A complete point-of-sale and billing system for The Baruch Cafe. It runs entirely
in the browser, needs no server, and deploys to GitHub Pages as-is.

Two roles, one screen each cashier needs, and a per-day Excel export that an
accountant can open without asking any questions.

---

## Contents

1. [What it does](#what-it-does)
2. [Technology](#technology)
3. [Running it locally](#running-it-locally)
4. [Build step](#build-step)
5. [Deploying to GitHub Pages](#deploying-to-github-pages)
6. [Sign-in accounts](#sign-in-accounts)
7. [The menu](#the-menu)
8. [Where the data lives](#where-the-data-lives)
9. [Excel export](#excel-export)
10. [Backup and restore](#backup-and-restore)
11. [Limitations of static hosting](#limitations-of-static-hosting)
12. [Moving to a real backend later](#moving-to-a-real-backend-later)
13. [Project layout](#project-layout)
14. [Automated tests](#automated-tests)
15. [Testing checklist](#testing-checklist)

---

## What it does

**For the cashier**

- Tap-to-add menu grid, 48 items across six categories, with instant search
  (`/` focuses the search box, `Enter` adds the first match).
- Tapping the same drink again bumps the quantity instead of adding a second row.
- Live subtotal, tax, discount and total, all recalculated as items change.
- Payment in Cash, UPI or Card. Cash shows quick-tender buttons and calculates
  change as you type.
- Printable bill, sized for a 76 mm thermal roll or ordinary paper.
- An unpaid order survives a refresh, a crash or a closed lid.

**For the admin**

- Everything above, plus:
- Dashboard: sales, bill count, average bill, payment split, top sellers,
  category split and a 14-day trading trend.
- Bill history with search and filters by date, cashier, payment method and status.
- Void a bill with a reason. The record stays in history and in exports, flagged
  and removed from totals, so the audit trail is never broken.
- Menu management: add, edit, reprice, reorder availability, attach photos.
- Settings: cafe details, tax, discounts, rounding, bill numbering, business-day
  numbering, user accounts.
- Excel export per business day, per date range, or everything.
- Backup and restore as a JSON file.

---

## Technology

| Layer | Choice | Why |
| --- | --- | --- |
| UI | Plain ES modules + CSS | No build step, no framework runtime, nothing to break at the counter |
| Storage | IndexedDB | Structured, transactional, survives refreshes and offline use |
| Excel | Hand-written OOXML writer (`src/lib/xlsx.js`) | No CDN dependency; exports work with no internet |
| Routing | Hash routes (`#/pos`) | Works at any GitHub Pages base path with zero configuration |
| Money | Integer paise, everywhere | Floating-point rupees drift; a till that drifts is a till nobody trusts |

There are **no runtime dependencies** — no npm install, no bundler, no
`node_modules`. The two web fonts load from Google Fonts and fall back to system
faces if the cafe's internet is down.

---

## Running it locally

**Double-click `start.bat` (Windows) or `start.command` (Mac).** That is the
whole procedure. A small console window opens and your browser lands on
<http://localhost:8000>. Leave that window open while the till is in use;
closing it stops the app.

### Why you cannot just double-click `index.html`

Opening the file directly gives you a blank white page. This is not a fault in
the app — it is a browser security rule, and it bites twice:

1. A page loaded from `file://` has **no origin**, and browsers refuse to load
   JavaScript modules into a page with no origin. None of the app's code runs.
2. **IndexedDB is blocked on `file://` in Chrome and Edge.** Even if the screen
   drew, not one sale could be saved.

Serving from `localhost` fixes both, and it is also what makes the Web Crypto
API available for password hashing (browsers expose it only on `https://` and
`localhost`). If someone does open the file directly, the page now detects it
and shows these instructions instead of a blank screen.

### If you prefer to start it by hand

```bash
python3 -m http.server 8000     # Python
node serve.js 8000              # Node — serve.js is included, no install
```

`serve.js` is a ~60-line static server built on Node's standard library, added
so the launcher works on a machine that has Node but not Python. It serves only
this folder and nothing above it.

If port 8000 is busy, pass another number: `node serve.js 8080`.

---

## Build step

There isn't one. What you see in the repository is what runs in the browser.

---

## Deploying to GitHub Pages

**Option A — automatic (recommended).** The included workflow deploys on every
push to `main`.

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages → Build and deployment**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main`. The workflow at `.github/workflows/deploy.yml` publishes the
   site and prints the URL in the run summary.

**Option B — no workflow.** Settings → Pages → Source → *Deploy from a branch*,
pick `main` and the `/ (root)` folder.

Two details that are already handled for you:

- **Base path.** Every asset is referenced relatively (`src/main.js`,
  `assets/logo.jpg`), and routing is hash-based, so the app works unchanged at
  `https://<user>.github.io/<repo>/` without any base-URL configuration.
- **`.nojekyll`.** Present in the repository root so GitHub serves every file
  as-is instead of running Jekyll over it.

---

## Sign-in accounts

Accounts are seeded into the browser the first time the app runs on a device.

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `baruch@2026` | Admin — full access |
| `cashier` | `cafe@1234` | Cashier — counter and payments only |

**Change both before the first real shift**: sign in as admin →
**Settings → Users → Password**. You can also add more cashiers there, disable an
account without deleting it, and give another person admin rights.

To change the seeded defaults before deploying, edit `DEFAULT_USERS` in
[`src/config/app.config.js`](src/config/app.config.js) — that file is the single
place credentials appear.

### About security, honestly

Passwords are stored as salted SHA-256 hashes rather than plain text, and role
checks run in the storage layer — a cashier calling the menu-write function
directly from the console gets refused, not just a hidden button. That is real,
and it is enough to keep a shared counter machine tidy.

It is **not** server-grade authentication. Everything runs on the client, so
anyone with the device, patience and DevTools can reach the underlying data.
This design is right for a single-shop till; it is not right for handling
card data or anything you would be legally liable for losing.

---

## The menu

All 48 items — names, prices and descriptions — come from the cafe's printed menu
and live in [`src/data/menu.seed.js`](src/data/menu.seed.js).

| Category | Items |
| --- | --- |
| Hot | 8 |
| Iced | 9 |
| Frappe's | 7 |
| Non-Coffee Based | 9 |
| Cold Brews | 6 |
| TBC Specials | 9 |

The seed file is only read the first time the app opens on a device. After that,
the live menu lives in the browser database and is edited from **Menu** in the
app. Editing the seed file will not change a device that has already been used —
to force it, use **Settings → Reset menu to the menu file** (this discards menu
edits; it does not touch past bills).

**Price changes never rewrite history.** When an item is added to an order, its
price, name, category and tax rate are copied onto the order line. Raising the
price of a Latte tomorrow leaves every Latte sold today reading exactly what the
customer paid.

---

## Where the data lives

Everything is stored in **IndexedDB in the browser on the device running the
app**, in six stores: menu items, transactions, business days, settings,
counters and users.

**Business days.** A day record is created by the first sale taken on a date, so
Day 1, Day 2, Day 3 follow *trading* days — a closed Monday does not consume a
number. Set the starting number and, if the cafe trades past midnight, a
rollover hour (e.g. `4` makes a 1 a.m. sale belong to the previous day) in
**Settings → Business days**.

**Bill numbers.** `ORD-000001` upward, allocated from a counter in the database.
Number allocation, the sale record and the day's running totals are written in a
single IndexedDB transaction that the app waits on until it commits. Either a
bill gets a unique number and is durably saved, or nothing happened at all — a
refresh mid-save cannot produce a half-written bill or a skipped number.

---

## Excel export

**Admin → Bills → Export to Excel**, or **Export today** on the dashboard.

- One business day → `Cafe_Billing_Day_01.xlsx` (the number is the business-day
  number, so Day 7 exports as `Cafe_Billing_Day_07.xlsx`).
- A date range → `Cafe_Billing_2026-08-01_to_2026-08-31.xlsx`.
- Everything → `Cafe_Billing_All_<last date>.xlsx`.

Each workbook has two sheets.

**Transactions** — one row per item, with frozen headers, filters and real Excel
data types (dates are dates, money is currency-formatted, quantities are
numbers). Columns: transaction id, bill number, business day, date, time,
cashier, payment method, status, item name, category, quantity, unit price, item
total, item discount, item tax, line total, then the order-level subtotal,
discount, tax, round-off and grand total, customer and note.

> **How to sum a column.** Order-level totals (subtotal, discount, tax, grand
> total) appear **once per order, on its first item row**, and are blank on the
> rest. That keeps every item tied to its bill while letting you put a plain
> `=SUM()` under the Grand Total column without counting an order twice.

**Daily Summary** — total sales, bills completed and voided, items sold, average
bill, discounts given, tax collected, a payment-method split, the top 15 sellers
and a per-cashier breakdown.

---

## Backup and restore

**Settings → Backup and restore.**

- **Export backup** downloads `Cafe_POS_Backup_<date>.json` containing the menu,
  every bill, business days, settings and user accounts.
- **Restore from backup** validates the file first, downloads a safety copy of
  what is currently on the device, and only then replaces anything. A damaged or
  foreign file is refused rather than half-imported.

**Take a backup at the end of each trading day.** Browser storage is durable but
not indestructible: clearing site data, a browser reset, or an aggressive
"clean-up" tool will take the sales history with it. The app asks the browser
for persistent storage on startup, which helps, but a file in your Drive helps more.

---

## Limitations of static hosting

**This deployment uses local browser storage. Data created on one device will not
automatically appear on another device.**

What that means day to day:

- The counter iPad and the manager's laptop each keep their own separate set of
  bills. Bill numbering is per device, so two devices billing at once will both
  produce an `ORD-000042`.
- **Run billing on one device.** To review sales elsewhere, export a backup from
  the till and restore it on the other device.
- Clearing browser data for the site erases the sales history on that device.
- Private/incognito windows discard everything on close — the app will warn you
  if it cannot open storage at all.
- Signing out ends the session; closing the tab does too, by design, so an
  unattended till does not stay open.

---

## Moving to a real backend later

The code is layered so this is a contained change rather than a rewrite:

```
views  →  services  →  repositories  →  db/database.js  →  IndexedDB
```

Views never touch storage. Every read and write goes through a repository
(`src/repositories/*.repo.js`), and only `src/db/database.js` knows IndexedDB
exists.

To move to Supabase, Firebase or your own API:

1. Reimplement the repository modules against the network, keeping the same
   exported function names and return shapes.
2. Delete `src/db/database.js` (or keep it as an offline cache).
3. Leave `src/views/`, `src/services/` and `src/ui/` alone.

Two things carry over unchanged and are worth keeping: money stays in integer
paise end to end, and saved transactions stay snapshots rather than references to
current menu rows.

---

## Project layout

```
start.bat                   double-click to run on Windows        ← start here
start.command               double-click to run on macOS          ← start here
serve.js                    tiny static server used by the above
index.html                  markup shell
manifest.webmanifest        installable-app metadata
.nojekyll                   tells GitHub Pages to serve files as-is
styles/app.css              design tokens, layout, components, print styles
assets/                     logo and favicon

src/
  main.js                   boot, routes, role guard
  config/app.config.js      credentials, defaults, payment methods  ← edit me
  data/menu.seed.js         the printed menu, 48 items              ← edit me
  core/
    money.js                integer-paise maths and formatting
    utils.js                DOM helpers, dates, business-day keys, files
    session.js              who is signed in; requireAdmin guard
    router.js               hash router
  db/database.js            the only file that speaks IndexedDB
  lib/xlsx.js               ZIP + OOXML writer
  repositories/             menu, transactions, business days, settings, users
  services/                 pricing, cart, orders, auth, export, backup, reports
  ui/                       shell, modals, toasts, receipt
  views/                    login, pos, dashboard, history, menu, settings

tests/pricing.test.mjs      66 assertions on the money maths
```

---

## Automated tests

The pricing engine is the one part of this app where a bug costs real money, so
it has a test suite that runs with no dependencies:

```bash
node tests/pricing.test.mjs
```

66 assertions covering integer-paise arithmetic, discount distribution (the
parts always sum to the whole, exactly), inclusive vs exclusive tax, per-item
tax overrides, discount caps, round-off, and the rule that a menu price change
must never alter a bill that was already printed.

## Testing checklist

Worth walking through after any change:

1. **Login** — wrong password refused; admin and cashier both get in.
2. **Role separation** — cashier sees no Menu/Settings/Dashboard links, and
   typing `#/settings` bounces back to the counter.
3. **Add items** — tapping the same drink twice merges to quantity 2.
4. **Quantities** — `+`, `−`, typing a number, and removing a line all update the total.
5. **Discount** — percentage and flat both apply; the parts still add up.
6. **Payment** — cash change is right; UPI and Card skip the cash box.
7. **Bill numbers** — first sale is `ORD-000001`, second is `ORD-000002`.
8. **Price change** — reprice an item, then reopen an earlier bill: it must still
   show the old price, while a new order uses the new one.
9. **Export** — `Cafe_Billing_Day_01.xlsx` opens in Excel with both sheets, and
   the Grand Total column sums to the day's sales.
10. **Refresh mid-order** — an unpaid order is still at the counter afterwards.
11. **Backup** — export, restore on a second browser profile, confirm bill count.
12. **Print** — the bill preview prints without the surrounding app chrome.

---

Built for The Baruch Cafe · Coffee • Eats • Community
