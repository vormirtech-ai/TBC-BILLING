# The Baruch Cafe — Billing & POS

A complete point-of-sale, billing and cafe-management system for The Baruch
Cafe. It is a static site — it deploys to GitHub Pages as-is, with no build
step — and it connects to one shared database so every till, tablet and laptop
sees the same cafe.

Billing and bill history, table QR ordering that reaches the counter by itself,
stock control with recipes, and staff attendance with an editable rota — plus a
per-day Excel export that an accountant can open without asking any questions.

**Start here:** deploy it, sign in, then open **Settings → The cafe database**
and connect it. Until you do, each device keeps its own separate books, and the
app tells you so in the top bar.

---

## Contents

1. [What it does](#what-it-does)
2. [Technology](#technology)
3. [Running it locally](#running-it-locally)
4. [Build step](#build-step)
5. [Deploying to GitHub Pages](#deploying-to-github-pages)
6. [Sign-in accounts](#sign-in-accounts)
7. [The menu](#the-menu)
8. [Tables and QR ordering](#tables-and-qr-ordering)
9. [The cafe database](#the-cafe-database)
10. [Stock](#stock)
11. [Staff, attendance and the rota](#staff-attendance-and-the-rota)
12. [Where the data lives](#where-the-data-lives)
13. [Excel export](#excel-export)
14. [Backup and restore](#backup-and-restore)
15. [What static hosting means](#what-running-on-a-static-host-does-and-does-not-mean)
16. [Moving to a real backend later](#moving-to-a-real-backend-later)
17. [Project layout](#project-layout)
18. [Automated tests](#automated-tests)
19. [Testing checklist](#testing-checklist)

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
- Seat an order at a table, and take orders that customers sent in from a table
  QR code — one tap turns a request into a bill.

**For the customer**

- Scan the QR code on the table, see the menu on their own phone, and send an
  order straight to the counter. No app to install and no sign-in.
- The counter's Orders button turns red and chimes the moment it arrives.
- Nothing is charged on the phone. An order is a request; staff confirm it and
  payment happens as usual.

**Across devices**

- One shared database. Bills, menu, stock, staff, rota and tables are the
  cafe's, not one browser's.
- The same username and password work on every device.
- Bill numbers are handed out by the database, so two tills billing at once
  cannot produce the same one.
- The counter keeps selling when the internet drops, and catches up by itself
  afterwards.

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
- Tables: add them in bulk, and each gets its own QR code automatically. Print a
  sheet of cards to cut up and stand on the tables.
- Stock: what is on the shelf, what needs ordering, what it is worth, and a
  movement record explaining every change. Recipes tie a menu item to its
  ingredients so a sale takes them off the shelf by itself.
- Staff: attendance with clock-in and clock-out, an editable week rota, and
  hours totalled for payroll.
- Excel export per business day, per date range, everything, plus stock and
  attendance.
- Backup and restore as a JSON file.

---

## Technology

| Layer | Choice | Why |
| --- | --- | --- |
| UI | Plain ES modules + CSS | No build step, no framework runtime, nothing to break at the counter |
| Storage | IndexedDB on the device, synced to Postgres | The till never waits on a network to take money; the cafe still shares one set of books |
| Sync | PostgREST over a free Supabase project | One table, two functions, no server of your own to run |
| Excel | Hand-written OOXML writer (`src/lib/xlsx.js`) | No CDN dependency; exports work with no internet |
| Routing | Hash routes (`#/pos`) | Works at any GitHub Pages base path with zero configuration |
| Money | Integer paise, everywhere | Floating-point rupees drift; a till that drifts is a till nobody trusts |

There are **no runtime dependencies** — no npm install, no bundler, no
`node_modules`, and no SDK for the database either: it is spoken to over plain
`fetch`. The two web fonts load from Google Fonts and fall back to system faces
if the cafe's internet is down.

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

## Tables and QR ordering

### Setting it up

1. Open **Tables** and use **Add several** — "8 tables, starting at 1" is one
   dialog, not eight.
2. Each table gets its own **QR code** immediately. Nothing to configure: the
   code points at wherever the app is being used, so it is correct on GitHub
   Pages, on a custom domain, or on a laptop, without being told.
3. Press **Print all QR cards**, cut the sheet up, and stand a card on each
   table.
4. After changing prices, open **Menu → Publish for QR ordering** (see below).

The QR code carries the site address, a random token identifying the table, and
the table's name. Nothing about the cafe's data is inside it. If a card walks
off or a code leaks, **New code** retires the old card instantly.

### What the customer sees

Scanning opens the menu on their phone — no app, no sign-in. They choose items,
review the order, and send it. The screen is honest about what just happened:
nothing is charged on the phone, and a member of staff confirms the order.

### How an order reaches the counter

**With the cafe database connected — the way this is meant to run — it just
arrives.** The customer presses Send, and within a few seconds the counter's
Orders button turns red, shows a count and chimes. Nobody scans anything. The
table card itself carries the connection, so a phone that has never been to your
cafe can reach it the moment it scans the code.

Accepting an order loads it onto the till, priced from the counter's own menu,
ready for payment. The customer's phone follows along: *Order sent* becomes
*Confirmed*, then *On its way*.

Two fallbacks exist for when the database is not connected, so an order is never
simply lost:

| Route | When | What happens |
| --- | --- | --- |
| **Same browser** | The customer menu is open in another tab on the counter device | The order appears in the queue instantly |
| **Handoff code** | No database connected | The phone shows a QR code and four characters; the counter scans or types them |

The handoff code is a genuine working method — it needs no network whatsoever —
but it asks a customer to wave a phone at a cashier, which is not what you want
during a rush. Connect the database and it never comes up.

### Publishing the menu

A phone that has never opened your site has no way to read the counter's
database, so customers read a **published copy** of the menu.

- With live ordering on: **Menu → Publish for QR ordering → Publish live**. Done.
- Without it: the same dialog downloads `menu.published.json`. Put that file in
  the site's `data/` folder, commit, and deploy. A copy is already included, so
  QR ordering works from the moment you host the site.

The dialog tells you whether the published menu still matches your working menu,
so you are never guessing. **Prices on a phone are only ever an estimate — the
counter prices every order from its own menu when it is billed.**

---

## The cafe database

**This is the part that makes it a cafe system rather than a till with a good
memory.** Connect it and every device shares one set of data:

- A bill rung up on the counter appears on the manager's laptop.
- The same username and password work on every device.
- An order from a customer's phone lands on the counter within seconds, with no
  code to scan and nobody to fetch.
- Menu, stock, staff, rota and tables are the cafe's, not one browser's.

Without it, every device keeps its own separate books. The app says so plainly
rather than letting you find out later: the top bar reads **"This device only"**
in amber until you connect it.

### Setting it up

There is a guided screen for this — **Settings → The cafe database → Set up**,
or the amber chip in the top bar. It walks through the four steps, checks its
own work, and copies the SQL for you. In short:

**1. Create a free database.** Sign up at [supabase.com](https://supabase.com)
and create a project. The free plan is far more than a cafe needs.

**2. Run the setup SQL.** Open the SQL Editor in your project, paste in the
block the setup screen gives you, and press Run. Once, ever. It creates one
table, one index, and two small functions for handing out bill numbers.

**3. Connect this device.** Project Settings → API gives you the **Project URL**
and the **anon public** key. Paste both into the setup screen and press Connect.

The app then works out which situation it is in, rather than guessing:

- **The database is empty** — this device's cafe becomes the shared data.
  Nothing is lost, and everything already on the till is uploaded.
- **The database already has a cafe in it** — this device adopts it. It says so
  first, and downloads a backup before replacing anything.

**4. Add your other devices.** Press **Show the pairing code** and scan it from
the next till, tablet or laptop. It picks up the connection, pulls the cafe's
data, and the same staff logins work immediately. No typing a JWT on a phone
keyboard.

### What it does when the internet drops

It keeps selling. Every write goes to the device first and queues for the
database, so the counter never waits on a network. When the connection returns
the queue drains by itself. The top-bar chip turns red and shows how many
records are still waiting.

Bills taken during an outage get a device tag on the end — `ORD-000042-K7` —
because two tills that cannot see each other must not both decide they are on
bill 42. Once online, numbers come from the database and are unique across
every device.

### Who can read and write it

The anon key is public by design; every Supabase web app ships one in its own
JavaScript. What protects the data is the app's own rules:

- A device with **nobody signed in** — a customer's phone — may write exactly
  one thing: the order it just placed. It cannot push a menu, settings, staff
  or bills, and the sync layer enforces that rather than trusting the screen.
- An order is a **request**. No payment happens on the phone, and staff accept
  it before it becomes a bill.
- The counter **prices every order from its own menu**, so a stale price on a
  customer's phone can never decide what is charged.

The table cards carry the connection so a scanned phone can reach the database,
which keeps the key on printed cards in your cafe rather than on the open web.
Treat a table card the way you would a spare key: fine on the table, not worth
posting online. If one goes missing, **New code** on the Tables screen retires
it instantly.

Use the **anon public** key. Never the service role key — that one bypasses
every rule above and must not leave the Supabase dashboard.

---

## Stock

Stock answers three questions, and the screen is arranged around them.

**What do I need to order?** Give each item a reorder level and the Stock screen
highlights anything at or below it, with a count on the navigation bar so you
notice without looking.

**Where did it go?** Nothing is ever silently overwritten. A level moves because
something happened — a delivery, a sale, a dropped jug, a recount — and each one
writes a movement record. **History** on any item shows the lot.

**What does a drink cost me?** A **recipe** links a menu item to what one portion
uses: 18 g of beans, 150 ml of milk. Every sale then takes that off the shelf by
itself, inside the same operation that saves the bill — so a bill can never be
saved while the ingredients it used stay on the shelf. Voiding the bill puts them
back. The recipe list also shows cost and margin per item.

Items with no recipe still sell perfectly well; they just do not move stock.

Two settings, under **Settings → Stock**:

- *Take ingredients off the shelf when something sells* — the whole feature,
  on or off.
- *Refuse a sale when an ingredient has run out* — **off by default, and that is
  deliberate.** A customer is standing at the counter with money in their hand.
  The usual answer is to warn the cashier and let the sale through, then let
  someone sort the shelf out afterwards.

Quantities are stored as whole thousandths of a unit, never as decimals, for the
same reason money is stored in whole paise: deduct 18 g four hundred times a week
in floating point and the figure quietly stops matching the shelf.

---

## Staff, attendance and the rota

Three separate things, kept separate on purpose:

- **Staff** — people who work at the cafe. Not the same as a till login: the
  kitchen porter has no reason to sign in, and a manager who leaves should lose
  their login without erasing the hours they worked last month.
- **The rota** — what someone is *meant* to work. A week grid, because that is
  how a rota is drawn on the wall. Click any cell to add a shift, click a shift
  to edit or delete it, and **Copy a day** builds next week from this one.
- **Attendance** — what actually happened. Clock in and clock out from the
  Today panel, and correct it afterwards, because the one certainty about
  clocking out is that somebody will forget.

**Hours this week** totals worked hours (clock times, less unpaid breaks) beside
rostered hours, and works out wages from each person's hourly rate. **Export
hours** produces the spreadsheet a payroll run starts from.

Shifts that cross midnight are handled properly everywhere — a 22:00–06:00 shift
is eight hours, not a negative day.

---

## Where the data lives

Every device keeps a full copy in **IndexedDB in its own browser**, across
fifteen stores: menu items, transactions, business days, settings, counters,
users, inventory, stock movements, recipes, staff, shifts, attendance, tables,
online orders, and the outbox of changes still to be shared.

**That local copy is the working set, not the master.** Writes go there first so
the counter never waits on a network, and each one queues in the outbox in the
same storage transaction — a bill and the reminder to send it cannot come apart.
A loop then pushes the queue up and pulls back everything changed elsewhere.
Where two devices disagree, the last write wins, judged by the database's clock
rather than either device's.

**Upgrading from an older version.** A till already holding sales keeps every
one of them. The upgrade only creates the stores that are missing, quietly gives
menu items the stable code QR ordering needs, and rebuilds the bill-number index
so bills synced in from another till are never refused. Nothing to do but
deploy.

**Business days.** A day record is created by the first sale taken on a date, so
Day 1, Day 2, Day 3 follow *trading* days — a closed Monday does not consume a
number. Set the starting number and, if the cafe trades past midnight, a
rollover hour (e.g. `4` makes a 1 a.m. sale belong to the previous day) in
**Settings → Business days**.

**Bill numbers.** `ORD-000001` upward, allocated from a counter in the database.
Number allocation, the sale record, the day's running totals *and the stock the
sale consumed* are written in a single IndexedDB transaction that the app waits
on until it commits. Either a bill gets a unique number, is durably saved and
its ingredients leave the shelf, or nothing happened at all — a refresh mid-save
cannot produce a half-written bill, a skipped number, or stock that went missing
without a sale to explain it.

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

### Stock and attendance exports

Two more workbooks, from the screens they belong to:

- **Stock → Export to Excel** — current levels, reorder flags and value on one
  sheet; every movement behind them on a second. A stocktake usually needs both
  open at once.
- **Staff → Export hours** — the week shown on screen, day by day on one sheet
  and totalled per person on the other, with hours as decimals because that is
  what payroll multiplies by.

---

## Backup and restore

**Settings → Backup and restore.**

- **Export backup** downloads `Cafe_POS_Backup_<date>.json` containing the menu,
  every bill, business days, settings, user accounts, stock and its movements,
  recipes, staff, the rota, attendance, tables and QR orders — everything.
- **Restore from backup** validates the file first, downloads a safety copy of
  what is currently on the device, and only then replaces anything. A damaged or
  foreign file is refused rather than half-imported.
- Backups from version 1 still restore. The sections they do not have simply
  come back empty.
- Table QR tokens survive a restore, so **printed cards keep working** on the
  restored device.

**Take a backup at the end of each trading day.** Browser storage is durable but
not indestructible: clearing site data, a browser reset, or an aggressive
"clean-up" tool will take the sales history with it. The app asks the browser
for persistent storage on startup, which helps, but a file in your Drive helps more.

---

## What running on a static host does and does not mean

GitHub Pages serves files. It runs no code of its own and holds no data. That
shapes two things, and it is worth being plain about both.

**What it does not stop.** The cafe's data is shared, because the app talks to
a database of your own rather than to the host. Bills, menu, stock and staff go
where every device can see them, and QR orders reach the counter on their own.
See [The cafe database](#the-cafe-database).

**What it does mean.**

- **Until you connect the database, every device keeps its own books.** A bill
  rung up on the counter will not appear on your laptop, bill numbers are per
  device, and an order from a customer's phone has to be handed over as a code.
  The top bar shows an amber **"This device only"** while that is the case.
- **The menu customers see is a published copy.** A phone that has never opened
  your site cannot read the counter's database until it scans a table card, so
  publish the menu after changing prices — **Menu → Publish for QR ordering**.
- **Clearing browser data still clears that device.** With the database
  connected the data comes back on the next sync, which is one of the better
  reasons to connect it. Keep taking backups regardless.
- **Private windows discard everything on close**, and the app will warn you if
  it cannot open storage at all.
- **Signing out ends the session**, and so does closing the tab, by design, so
  an unattended till does not stay open.

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
data/menu.published.json    the menu customers see when they scan a table code

src/
  main.js                   boot, routes, role guard
  config/app.config.js      credentials, defaults, payment methods  ← edit me
  data/menu.seed.js         the printed menu, 48 items              ← edit me
  core/
    money.js                integer-paise maths and formatting
    quantity.js             integer-thousandths maths for stock
    utils.js                DOM helpers, dates, business-day keys, files
    device.js               this browser's id and its bill-number tag
    session.js              who is signed in; requireAdmin guard
    router.js               hash router
  db/database.js            the only file that speaks IndexedDB
  lib/
    xlsx.js                 ZIP + OOXML writer
    qrcode.js               QR encoder — no dependencies, works offline
  repositories/             menu, transactions, business days, settings, users,
                            inventory, staff, tables, online orders
  services/                 pricing, cart, orders, auth, export, backup, reports,
                            order channel, published menu
    cloudSync.service.js    speaks to the shared database over plain fetch
    sync.service.js         push, pull, outbox, and who wins a disagreement
  ui/                       shell, modals, toasts, receipt
  views/                    login, pos, dashboard, history, menu, settings,
                            tables, orders, inventory, staff, customer,
                            setup (connect the database), join (pair a device)

tests/
  run.mjs                   runs everything below
  pricing.test.mjs          66 assertions on the money maths
  cafe.test.mjs             78 on quantities, shifts, handoff codes, menu codes
  qrcode.test.mjs           138 round-tripping QR codes through a decoder
```

---

## Automated tests

No dependencies, no install, no test runner to configure:

```bash
node tests/run.mjs
```

282 assertions across three files.

**`pricing.test.mjs` — 66.** The one part of this app where a bug costs real
money: integer-paise arithmetic, discount distribution (the parts always sum to
the whole, exactly), inclusive vs exclusive tax, per-item tax overrides,
discount caps, round-off, and the rule that a menu price change must never alter
a bill that was already printed.

**`cafe.test.mjs` — 78.** Stock quantities (including four hundred deductions
that must not drift), shift and attendance maths (including shifts that cross
midnight), the handoff code that carries an order between two devices — proving
a mistyped one is refused and that no price ever travels in it — and the stable
menu codes two devices use to agree on what an item is.

Cross-device behaviour cannot be tested this way — it needs two browsers and a
database — so it is covered by driving the real app against a stand-in for
PostgREST: a bill made on one device appearing on another, one login working on
a device that never had it, a QR order arriving on its own, and a bill taken with
the network pulled out reaching the other device once it returns.

**`qrcode.test.mjs` — 138.** The QR encoder, round-tripped through an
independent decoder written into the test file: every correction level, every
mask, multibyte text, and the structural rules a scanner depends on. While it
was being written the encoder was also checked module-for-module against an
independent implementation across versions 1 to 33, and its output was decoded
back out of an actual screenshot of a rendered table card.

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
13. **Tables** — add several at once; each card shows a QR code; **Print all QR
    cards** produces a sheet with nothing but the cards on it.
14. **Scan a table code with a real phone** — the menu opens and names the right
    table.
15. **QR order** — send one from the phone, then take it in at the counter with
    **Scan a customer's code**. The till should show the right items at *your*
    prices, seated at the right table.
16. **Stock** — give an item a recipe, sell it, and check the shelf went down by
    the right amount. Void the bill and check it came back.
17. **Low stock** — set a reorder level above the current level and confirm the
    count appears on the Stock tab.
18. **Rota** — add a shift, edit it, copy a day onto another day.
19. **Attendance** — clock someone in and out, then correct the times and check
    the hours follow.

With the cafe database connected:

20. **Two devices** — connect the counter, pair a second device with the code,
    and check the top bar reads **Shared** on both.
21. **A bill crosses over** — ring one up on the counter; it should appear in
    Bills on the other device within a few seconds.
22. **One login everywhere** — change the admin password on one device and sign
    in with it on the other.
23. **Bill numbers** — bill from both devices and confirm the numbers do not
    collide.
24. **A QR order arrives by itself** — order from a phone and watch the counter's
    Orders button turn red without anybody scanning anything.
25. **Pull the network out** — take a bill with wi-fi off (it should still go
    through, numbered like `ORD-000042-K7`), then reconnect and confirm it
    reaches the other device.

---

Built for The Baruch Cafe · Coffee • Eats • Community
