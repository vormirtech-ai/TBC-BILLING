<div align="center">
  <img src="app/assets/saba-logo.png" alt="Saba Fine Dine" width="160">

  <h1>Saba Restaurant Suite</h1>
  <p><strong>Billing, kitchen order tickets and floor management for fine dining.</strong><br>
  Runs on the restaurant's own network. No internet, no subscription, no dependencies.</p>
</div>

---

## What it is

One small server on a computer in the back office, and a browser on every
screen in the building: the captain's tablet, the pass in the kitchen, the
till at the front, the manager's laptop. They all read and write the same
tables at the same time. Unplug the internet and nothing changes.

It is written in plain JavaScript against Node's own standard library. There
are **no runtime dependencies at all** — nothing to `npm install`, nothing to
compile on the till, nothing that goes stale between now and the restaurant's
third year of using it.

## What it does

| | |
|---|---|
| **Floor** | Live plan of every room. Seat, move, merge and transfer tables; covers, elapsed time and running total on each; reservations seated straight onto the plan. |
| **Order** | The carte by course, with modifiers, allergy notes and seat numbers. Fire a course and the kitchen sees it before the captain has put the tablet down. |
| **Kitchen** | A ticket per course per station, timed, with the ones that are running late brought to the front. Bump, recall, reprint. |
| **Bills** | Print, split (by seat, by item, or evenly), part-pay across cash, card and UPI, discount with manager approval, void and comp with a reason that is kept. |
| **Tax** | Service charge and CGST/SGST worked out per line, in whole paise, with the rates and the round-off set in one place. |
| **Reports** | Today's trading as it happens; the Z report and cash-up at close; thirty days of history; sales by item, by hour, by server and by payment method; a GST summary; CSV export of all of it. |
| **Book** | Reservations with covers, time, table and a note, carried through to the floor plan. |
| **Menu** | Add a dish, price it, move it between sections, courses and stations, retire it, and 86 it from anywhere in the building. |
| **Setup** | The bill header, staff and their PINs, the service charge and tax rates, the rooms and tables, backups, and the live list of terminals. |

Every screen is one of four roles' business — manager, captain, cashier,
kitchen — and the server enforces that, not the interface.

## Getting it running

**On a restaurant's till** (Linux, systemd, Node 22.5+):

```sh
sudo ./install.sh
```

**In Docker:**

```sh
docker compose up -d
```

**To look at it right now**, with a month of trading and a room mid-service
already in it:

```sh
npm run demo        # then open http://localhost:8080, PIN 1379
```

All three print the address to open on the tablets, and the manager PIN, once.

Full instructions, including the network and the printers:
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Running it day to day

Opening and closing, the Z report, backups, restoring one, adding staff,
changing prices, and what to do when something goes wrong:
**[docs/OPERATIONS.md](docs/OPERATIONS.md)**.

## Taking it over

The shape of the code, where each decision lives, how to change the tax
rules, add a screen or add a role, and the things a future maintainer would
otherwise have to find out the hard way:
**[docs/HANDOVER.md](docs/HANDOVER.md)**.

## Tests

```sh
npm test
```

Seventy-eight cases: the pricing and order maths as pure functions, and the
rest against a real server on a real SQLite database over real HTTP. Nothing
is mocked. A point of sale is a thing that takes money; a suite that stubs
out the database proves only that the stubs work.

## Requirements

- Node 22.5 or newer (22.22 LTS is what the Docker image pins).
- A computer that stays switched on. A mini PC or a Raspberry Pi 5 is plenty.
- A wifi network the tablets can reach it on. It does not need internet.

## Licence

Commercial. One licence per restaurant. See [LICENSE.txt](LICENSE.txt).
