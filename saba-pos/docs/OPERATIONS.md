# Running Saba

Written for whoever runs the restaurant, not for whoever installed it. You
do not need to know anything about computers to follow it.

If something is wrong right now, go to [When something goes
wrong](#when-something-goes-wrong).

---

## The day

### Opening

1. Switch on the tablets and the kitchen screen. They are already pointed at
   the right address.
2. Each person taps their own name and types their own PIN. Not somebody
   else's: everything anybody does is recorded against the name that was
   tapped, and that record is what settles an argument three weeks later.
3. The cashier opens the till from **Reports → Day close → Open the till**,
   counting in the float. That is the figure the end-of-day cash-up is
   measured against. If it is not opened, everything still works; the cash-up
   simply has nothing to compare the drawer to.

### During service

**Seating.** Floor → tap a vacant table → covers, and a name if there is
one. A reservation due now sits on its table already; tapping it seats it.

**Ordering.** Tap the table, then the dishes. Items sit in a **holding list**
until a course is **fired** — that is the moment the kitchen sees them, and
not before. It is the single most useful habit to teach: take the whole
order, then fire the starters.

**Seats.** If the seat numbers are set as the order is taken, splitting the
bill by seat later takes one tap instead of five minutes.

**The kitchen.** Each fired course becomes a ticket per station. The pass
bumps a ticket when it goes out. A ticket turns amber at three quarters of
its target time and red past it, so the late table is the one at the front.

**86.** Out of the sea bass? **Menu → tap the dish → 86**, or from the order
screen. Every tablet in the building stops offering it within a second.

**Moving a table.** Floor → Move / merge. Moving takes the whole order with
it. Merging puts two tables onto one bill.

### Billing

Bills → the table → **Print bill**. That takes the invoice number; from then
on the bill is on the record.

| | |
|---|---|
| **Split** | By seat, by item, or evenly. Each share is a real bill with its own proportional service charge and tax, so the shares always add back to the total. |
| **Part payment** | Add as many payments as the table wants, across cash, card and UPI, until the balance is nothing. |
| **Service charge** | A cashier can take it off any bill without asking anybody. A guest who asks for that should never get an argument. |
| **Discount** | Up to the configured threshold (15% as shipped), anybody who can open the bill screen. Above it, a manager's PIN at the moment it is given. |
| **Comp** | The house is giving it away. It shows on the bill at nil and in the day's comps. |
| **Void** | It should never have been charged. Needs a reason, and a manager's PIN if the kitchen has already seen it. |
| **Settle** | Once the balance is nothing. The table goes back to vacant and the bill is closed. |

Reopening a settled bill needs a manager and is recorded.

### Closing

1. Last tables settled, so nothing is still open.
2. **Reports → Day close** is the Z report: the takings by tender, the day in
   full from items down to the total taken, tax by component, and every void,
   comp and discount with who authorised it.
3. On the same screen, **Count the drawer and close**. Saba shows what should
   be in it; you type what is. Both figures and the variance are kept.
4. Export the day if the accountant wants it: **Reports → Sales → Take the
   figures away** gives a sales CSV and a GST summary that open in any
   spreadsheet.
5. Leave the till computer switched on. The backup runs at 04:30.

The business day rolls over at **05:00**, not midnight, so a service that
runs to two in the morning stays on the night it belongs to.

---

## The things an owner changes

All of it is in **Setup**, and all of it takes effect on every screen in the
building within a second. Nothing needs a restart and nothing needs us.

| | |
|---|---|
| **The restaurant** | The name, address, GSTIN and FSSAI number as they are to be printed on the bill. |
| **People** | Add somebody, give them a role and a PIN, switch them off when they leave. Switching off is better than deleting: what they did stays on the record. |
| **Charges and tax** | The service charge and what it is called, the tax components and their rates, rounding, and the discount above which a manager has to approve. Changing a rate changes every bill from that moment; bills already settled keep the figures they were settled with. |
| **Menu** | Add a dish, change its price, move it to another section, course or station, or take it off the menu. Prices are typed in rupees. A dish is taken off rather than deleted, so a bill from last March still says what was eaten. |
| **The room** | Rooms and tables, and how many each table seats. A table with an open bill on it cannot be taken away. |

### Staff and PINs

Four roles. Each opens only what it needs, and the till enforces that — a
captain's tablet cannot show the day's takings even if somebody types the
address in by hand.

| Role | Opens |
|---|---|
| **Manager** | everything, including Setup and the takings |
| **Captain** | floor, order, kitchen, bills, reservations — but not the takings, and not Setup |
| **Cashier** | floor, order, bills, reports |
| **Kitchen** | the kitchen display, and nothing else |

Two people cannot share a PIN; Saba refuses it. If somebody forgets theirs, a
manager sets a new one in Setup → People, which also signs that person out
everywhere. If **everybody** is locked out, see below.

---

## Backups

The whole restaurant is one file. A backup is taken automatically every night
at 04:30 and the last fourteen are kept.

**Take one now:** Setup → Back up now → **Back up**.
**Keep one off the premises:** Setup → Back up now → **Download a copy**,
onto the owner's laptop or a USB stick. Do it weekly. A backup that lives only on the
till is not a backup — the fire that takes the till takes it too.

### Restoring a backup

This replaces everything the restaurant has recorded since that backup was
taken, so it is deliberately not something that can be done by tapping a
screen. On the till computer:

```sh
sudo systemctl stop saba
sudo -u saba node /opt/saba/tools/restore.mjs /var/lib/saba/backups/<the file>.db
sudo systemctl start saba
```

It shows what it is about to do and asks you to type RESTORE. The database it
replaces is kept beside the new one, so restoring the wrong file is itself
undoable.

---

## When something goes wrong

### A tablet says it cannot reach the till

The till computer is off, asleep, or the wifi has dropped. Check it is
switched on and that the tablet is on the restaurant's network and not the
guest one. Nothing is lost: anything typed while the link was down is held
and sent when it comes back.

### The band at the top says the link is down

Keep working. Orders and changes queue in order and go through the moment the
link returns — the band shows how many are waiting. What you cannot do while
it is down is settle a bill, because the till has to confirm that.

### One tablet shows something different from another

Reload the page. The terminals hold a copy of what the till said, and a
reload fetches it again. If it keeps happening on one device, that device's
wifi is weak.

### A dish is missing from the order screen

It has been 86'd, or it has been taken off the menu. Menu → the dish.

### The bill does not add up

It does, and the way to see why is **Reports → Audit**, which lists every
void, comp, discount and reopen of the day with who did it and who approved
it. Discounts and comps are shown separately from the items, and the bill
itself prints each step of the arithmetic.

### Everybody is locked out

A run of wrong PINs locks a terminal out for a minute; wait it out. If a PIN
is genuinely lost and there is no manager who can sign in, that needs us: the
PINs are stored hashed and cannot be read back out of the database by anyone,
including us. Recovery means adding a manager account directly on the till.

### The whole thing is behaving strangely

Restart it. On the till computer:

```sh
sudo systemctl restart saba
```

It comes back in a second or two with nothing lost. Then tell us what it was
doing, with the time it happened — the log will have it:

```sh
journalctl -u saba --since "today" > ~/saba-log.txt
```

---

## What it will never do

- Phone home. It makes no outbound connections of any kind. The restaurant's
  trading is nobody's business but the restaurant's.
- Stop working because a subscription lapsed, a licence server went down, or
  the internet did. There is no licence check in the software.
- Hold the data hostage. It is one SQLite file, in an open and documented
  format, on hardware the restaurant owns. It can be copied, read and taken
  elsewhere at any time, with or without us.
