# Saba — Fine Dining Billing & KOT

An offline billing and kitchen-order-ticket system for a fine-dining restaurant.
This package is a **working demonstration build**: it runs entirely on the
device, makes no network requests of any kind, and opens on a restaurant in the
middle of service so there is something real on every screen from the first
second.

---

## Opening it

**The quickest way — no install, no server, works offline**

Double-click **`Saba-Demo.html`**.

That single file contains the whole system: the code, the stylesheets and the
artwork. It opens in Chrome, Edge, Firefox or Safari, from a folder, a USB stick
or an email attachment, with the network cable pulled out.

**The developer way — the readable source**

```
npm start                    # serves on http://localhost:8000
npm test                     # 72 tests
npm run build                # regenerates Saba-Demo.html
```

Or without npm at all:

```
python3 -m http.server 8000
node tests/all.mjs
node build.mjs
```

There is nothing to install: `package.json` declares no dependencies, only
shortcuts. There is no bundler config and no framework. Node is used solely to
run the tests and to produce the single-file build; the application itself needs
neither.

---

## Signing in

Four accounts, each landing on the screen that role actually needs. The PINs are
printed on the lock screen because nothing here is real; a live install issues
one PIN per person and never displays it.

| PIN | Who | Sees |
| --- | --- | --- |
| `1111` | Farid Naqvi — Restaurant Manager | Everything, including voids, reports and setup |
| `2222` | Alina Rahman — Captain | Floor, orders, kitchen, bills, the book |
| `3333` | Devesh Kamat — Cashier | Floor, orders, bills, reports |
| `4444` | Pass — Kitchen | The kitchen display, and nothing else |

---

## Walking a client through it

Six moments, in the order that makes them land. The same list is inside the app
under **Guide** in the navigation rail, with a button that takes you to each
screen. If a demo goes off the rails, **Setup → Reset** puts the whole evening
back exactly as it started.

**1. Open on a room that is already busy — `Floor`**
Eight tables are in service. The stripe down each card says what is happening:
gold is seated, amber means food is in the kitchen, green means everything is on
the table, burgundy means the bill has been printed. Table 6 carries a red dot —
a plate has been sitting on the pass too long, and the floor plan is the first
place that shows.

**2. Take an order the way a captain does — `Order`, terrace G2**
Pick a seat number at the top, tap a dish, and it lands on that seat under its
course. Try the **Barg Fillet**: it asks for doneness, because a fine-dining
system that does not ask is not one. Nothing has gone to the kitchen yet —
everything is *held*.

**3. Fire a course, and watch it split by station**
Press **Fire**. One order becomes one docket per kitchen section: the tandoor
never sees the dessert line, the bar never sees the lamb. That split is the
single thing cheap systems get wrong, and it is why food arrives cold.

**4. Stand at the pass — `Kitchen`**
The kitchen display, set to be read at three metres. Colour carries one thing
only: how long this has been waiting against that station's own target. The
Tandoor ticket for table 6 is pulsing because it was plated a quarter of an hour
ago and no runner has taken it. Bump one to **Ready**, then **Away**, and watch
the floor plan change colour behind you.

**5. Split a bill three ways — `Bills`, table 6**
Down the middle, by item, or — the one worth showing — **by seat**, which works
only because the captain recorded seat numbers when the order was taken. Each
share carries its own proportion of the service charge and the tax, so the
shares add back to exactly the one bill.

**6. Show what a manager can see — `Reports`**
Thirty days of trading, average check, table turn time, kitchen timings by
station, and the **Audit** tab: every void, comp and discount with the reason
given and the manager who authorised it.

---

## What is in it

### Floor

- Sections drawn as an actual plan of the room — Main Hall, Garden Terrace, the
  Rose Room private dining, and the bar counter — with tables where they stand.
- Seven table states derived from the order, never stored separately: vacant,
  reserved, seated, in kitchen, served, bill printed, clearing.
- Covers, guest name, running value and time at table on every card.
- An alert when plated food has been left on the pass.
- Move a table, or merge two together; dockets and courses travel with the order.

### Order taking

- The full carte by section, searchable, with dietary marks, allergen codes and
  chef's signatures.
- **Seat numbering** — one tap, and the bill can be split by seat later with no
  re-keying.
- **Courses** — Amuse, Starters, Mains, Dessert, Beverages, with a pacing strip
  showing where each course has got to.
- Modifiers and portions (doneness, heat, half portions, sharing platters,
  additions), each carrying its own price.
- Free-text notes that print on the kitchen docket in a box, in capitals.
- Table notes — allergies, celebrations, pacing — printed on every docket.
- 86 an item from the order screen or the menu manager; it stays visible so a
  captain can tell a guest it has gone, but nobody can order it.

### KOT and the kitchen display

- **Firing is a separate act from ordering.** Items sit held until their course
  is fired, so the mains are not plated while the guests are on the starters.
- **One docket per station.** Five sections — Hot Range, Tandoor & Grill, Cold
  Larder, Pastry, Bar — each with its own service target.
- A kitchen display with per-station tabs, live timers, and colour that means
  one thing only: green comfortable, amber past three quarters of the target,
  red past it, pulsing when it is half again over or has been left on the pass.
- All-day counts: how many of each dish the kitchen still owes the room.
- Bump to Ready, then Away; recall from the pass if a runner never came.
- Reprint a docket (marked as a reprint) or void one, which prints a cancellation
  slip at the station.

### Billing

- Proforma and tax invoice, on A4 or 80mm thermal, from the same document.
- Service charge, removable per bill by the cashier without approval.
- Discounts by percentage or flat amount, with a reason; anything above 15% asks
  for a manager's PIN and records who gave it.
- Comps — a dish put on the house — shown on the bill and charged at nothing.
- Gratuity, added after tax and never taxed.
- **Splitting**: evenly, by item, or by seat. Each share carries its proportion
  of the discount, service charge and tax.
- Multiple tenders on one bill: cash, card, UPI, room charge, voucher, with
  change due and quick-cash denominations.
- Reopen a settled bill — manager only, always logged.

### Reports

- Net sales, covers, average check, spend per cover, table turn time, service
  charge, gratuity and discounts, each against the previous period.
- Trading pattern by hour, daily trend across the range, payment mix, sales by
  section of the carte, and sales by captain.
- **Menu performance** — every dish ranked by revenue with its food cost and
  gross margin, which is the report that actually changes a menu.
- **Kitchen** — average prep time per station against its target, how many
  dockets are still cooking, and how many ran late.
- **Audit** — every void, comp and discount with reason and approver, plus a
  full activity log.

### Also

- Reservations for the evening, seatable in one tap straight into an order.
- Menu manager: prices, food costs, margins, station routing and the 86 board.
- Setup: the restaurant's details, charges and tax, printers, station targets,
  people, and a one-button reset of the whole demo.

---

## How it is built

**No dependencies. No build step for the app itself. No network.**

The application is plain ES modules, plain CSS and the DOM. There is no
framework, no bundler, no package.json and nothing to install. It makes zero
network requests — not for fonts, not for icons, not for analytics — which is
the whole argument for a restaurant on a Saturday night with a dead line.

```
Saba-Fine-Dining-Demo/
  START-HERE.txt          one page, for whoever opens the zip first
  Saba-Demo.html          the single-file build — this is what you open
  README.md               this file
  index.html              the multi-file entry, for development
  build.mjs               produces the single file from src/
  assets/                 the medallion, the watermark, the favicon (SVG)
  styles/
    app.css               design system and every screen
    print.css             the guest bill and the kitchen docket
  src/
    config.js             tax, charges, roles, stations, courses — one place
    core/                 dom, money, dates, router, store
    domain/               pricing, orders and KOTs, reports — pure, testable
    data/                 the carte, the floor plan, and the opening state
    ui/                   shell, components, icons, printed documents
    views/                one file per screen
  tests/                  72 tests, run with `node tests/all.mjs`
```

A few decisions worth knowing about:

**Money is integer paise, everywhere.** It becomes a decimal string only at the
moment it is drawn. A bill that adds 0.1 + 0.2 in floating point and rounds at
the end can disagree with its own printed lines by a rupee, and a guest who
spots that stops trusting the system. There is a test asserting that the printed
lines always sum to the printed total.

**One source of truth for state.** Screens never mutate anything directly; they
read through selectors and act through operations in `src/state.js`. That is why
a table freed on the floor plan and the same table on the kitchen display can
never disagree, and why every void ends up in the audit log.

**Table status is derived, not stored.** It is worked out from the order's own
lines and dockets. Two sources of truth would drift apart the first time a
docket was voided.

**Reports are derived on demand.** Nothing is cached, so a report cannot
disagree with the bills it summarises.

**The printed bill and the on-screen preview are the same code.** There is no
second template that could quietly drift out of step.

**The trading history is generated, not stored.** Thirty days of full orders
would be most of a megabyte of local storage for something that never changes,
so it is rebuilt at boot from a seeded generator — which also means the same day
always shows the same figures, and a number a client noticed in the morning is
still there in the afternoon.

### The single-file build

`build.mjs` walks the module graph from `src/main.js`, inlines the stylesheets
and the artwork as data URIs, and embeds each module as its own source string.
At load time each becomes a Blob URL, in dependency order, with its imports
pointing at the URLs of the modules it needs — so the browser loads genuine ES
modules with real module scope. The code that runs from the single file is the
same code, with the same semantics, as the code in `src/`.

It fails the build rather than guess: a dynamic `import()`, a bare specifier or
a circular import stops it with an explanation.

### Storage

State is saved to this browser's local storage as you go, so closing the tab
loses nothing. Where a browser refuses it — a private window, an opaque
`file://` origin — the app runs perfectly well from memory for the session and
says so on the lock screen rather than failing.

---

## The brand

The medallion is rebuilt as vector artwork from the Saba mark: the geometric
border is one motif repeated twenty-six times around the ring, so it stays
exactly seamless at any size, and the whole thing is under 5 KB.

Everything in the interface is drawn from it and nothing else — the burgundy of
the wordmark, the antique gold of the border, the cream of the field, and the
single leaf-green of the rose stem. Burgundy is reserved for money and for the
one action that matters on each screen; gold is a frame, never a button; green
only ever means *this has been served*.

The watermark sits at 3.5% behind the screens and 5% behind the printed bill. It
should read as embossing on good stationery, not as a stamp — if you can see it
without looking for it, it is too strong.

**To swap in the restaurant's own artwork**, replace `assets/saba-logo.svg` and
`assets/saba-watermark.svg` and rerun `node build.mjs`. Both are referenced from
exactly one place each: `ASSETS` in `src/config.js`, and `--medallion` at the
top of `styles/app.css`.

Type is a Renaissance serif for the brand, the covers and every figure with cash
value, against a plain interface sans for anything staff scan under pressure.
Both are system faces, so the demo looks identical online and off.

---

## What this build is not

It is an honest demonstration, so it is worth being plain about the line between
what is finished and what a live install would add.

- **The PINs are printed on the lock screen and the accounts are hard-coded.**
  Everything runs client-side, so this is a role separation, not a security
  boundary. A real install needs proper accounts and a server that enforces them.
- **Printing goes through the browser's print dialog.** The documents generated
  are exactly what a thermal printer receives; only the transport differs. A live
  install drives the station printers directly.
- **There is one terminal.** Real service runs several, which needs a local
  server so the floor, the pass and the till share one set of tables.
- **Most of Setup is read-only.** Those settings are configuration in a live
  install; they are shown so you can see what is on offer.
- **No stock control, no purchasing, no payroll, no accounts integration.** All
  are ordinary work on top of this foundation, not a rewrite of it.

---

*Saba Restaurant Suite · demonstration build · runs entirely on the device*
