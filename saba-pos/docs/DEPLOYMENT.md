# Installing Saba

Everything here is done once, by whoever sets the restaurant up. The people
who will use it every day want [OPERATIONS.md](OPERATIONS.md) instead.

---

## 1. What the restaurant needs

**One computer that stays switched on.** It holds the database and serves
every other screen. It does not need to be powerful — a mini PC, an Intel
NUC, a Raspberry Pi 5, or the back-office PC that is already there. It needs
Node 22.5 or newer, a wired connection to the router if possible, and
somewhere out of the way where nobody will unplug it.

**A wifi network the tablets can reach it on.** The restaurant's own router
is enough. There is no internet requirement — install it, pull the WAN cable
out, and the restaurant trades exactly the same.

**A screen in the kitchen**, if the kitchen is to see tickets rather than
print them. Any cheap tablet or monitor with a browser.

**Terminals.** Anything with a current browser: iPads, Android tablets,
Windows tills, a laptop. Nothing is installed on them; they open a web
address. Ten-inch and up is comfortable; a phone works for a quick look at
the floor but is cramped for taking an order.

**A printer**, if bills are to be printed rather than shown. See §6.

---

## 2. Installing

### On a Linux till (the normal way)

```sh
sudo ./install.sh
```

That creates a `saba` system user that owns nothing else, copies the
application to `/opt/saba`, puts the database in `/var/lib/saba`, installs a
systemd service that starts with the machine and restarts if it ever falls
over, and sets up a nightly backup at 04:30.

When it finishes it prints the address to open on the tablets. The manager
PIN is printed once, at first start:

```sh
journalctl -u saba | grep PIN
```

### In Docker

```sh
docker compose up -d
docker compose logs saba | grep PIN
```

The database lives in the `saba-data` volume. The container runs read-only,
with no capabilities and no new privileges; `/data` is the only thing it can
write to.

### By hand, anywhere else

```sh
SABA_DATA_DIR=/somewhere/to/keep/the/database node server/main.js
```

Node 22.5+ is the only requirement. There is nothing to install first.

### To demonstrate it

```sh
npm run demo
```

A month of trading, a full carte, a floor plan and eight tables mid-service,
on a throwaway database. The manager PIN is 1379. Never do this on a
restaurant's real install — see §8.

---

## 3. Configuration

Every setting is an environment variable with a working default, so a stock
install needs none of them. `.env.example` lists all of them with notes. The
ones that usually get changed:

| Setting | Default | Why you would change it |
|---|---|---|
| `SABA_PORT` | `8080` | Another service already has 8080. |
| `SABA_DATA_DIR` | `./data` | Put the database on a different disk. |
| `TZ` | `Asia/Kolkata` | **Set this.** Business days, reports and the day-end close are all worked out in local time. |
| `SABA_SETUP_PIN` | generated | Choose the first manager's PIN yourself instead of reading it out of the log. |
| `SABA_SESSION_HOURS` | `14` | A terminal stays signed in for one full service plus the close. |
| `SABA_BACKUP_KEEP` | `14` | A fortnight of nightly backups. Raise it if the disk is large. |

With systemd, put overrides in `/etc/saba.env` — the unit reads it and it
survives upgrades. With Docker, put them in `.env` beside the compose file.

---

## 4. The network

### Give the till a fixed address

The tablets are bookmarked to an address. If the router hands the till a new
one next Tuesday, every tablet in the building stops working. Either reserve
its IP in the router's DHCP settings (easiest, do it from the router's admin
page using the till's MAC address), or set a static address on the till
itself.

Then bookmark `http://<that address>:8080` on every terminal and add it to
the home screen. The app is a PWA: added to the home screen it opens
full-screen, with no browser chrome for a guest to see.

### Keep it off the internet

**Do not port-forward Saba.** It is designed for a staff-only network behind
a till. Four-digit PINs and an open sign-in roster are the right trade-offs
for a device bolted to a counter in a back office; they are the wrong
trade-offs for anything a stranger can reach.

If somebody genuinely must reach it from outside the building, put it behind
a VPN — not behind a password page. If it is served over HTTPS through a
reverse proxy you control, set `SABA_SECURE_COOKIES=1` so the session cookie
is marked Secure, and `SABA_TRUST_PROXY=1` so the PIN rate limiter sees real
client addresses rather than the proxy's. Setting `SABA_TRUST_PROXY=1`
*without* a proxy in front lets any client spoof its address and defeat that
limiter, so leave it off otherwise.

### Wifi

Put the terminals on the restaurant's own network, not the guest one, and
give the guest network no route to the till. If the dining room is large,
one access point at each end beats one in the middle: a captain walking out
of range mid-order will see the link indicator go amber, and the order is
held and sent when they walk back in — but it is better not to make them.

---

## 5. First run

1. Open the address on the manager's device and sign in with the setup PIN.
2. **Setup → People.** Add the real staff, each with their own PIN and role.
   Then change the Manager account's PIN from the one in the log — it was
   printed in plain text, so treat it as already known.
3. **Setup → Restaurant.** The legal name, the address, the GSTIN and the
   FSSAI number as they must appear on a bill.
4. **Setup → Charges.** The service charge, the CGST and SGST rates, whether
   totals round to the rupee, and the discount above which a manager has to
   approve.
5. **Menu.** The carte. Add each dish with its price, its menu section, the
   course it belongs to and the station that cooks it. Priced in rupees; held
   internally in paise, so nothing drifts. (Modifier groups — doneness, heat,
   portion — are set in `app/src/shared/catalogue.js`; see
   [HANDOVER.md](HANDOVER.md).)
6. **Setup → The room.** The rooms and the tables, with covers per table.
   A new table is placed in the first free spot in its room.

Each of those is a screen; none of them needs a text editor or a restart.

### The four roles

| Role | Opens | Typically |
|---|---|---|
| **Manager** | everything | the owner, the restaurant manager |
| **Captain** | floor, order, kitchen, bills, book | waiting staff |
| **Cashier** | floor, order, bills, reports | the till |
| **Kitchen** | the kitchen display | the pass |

Roles are enforced by the server, on every request, not by hiding buttons. A
captain's tablet cannot read the day's takings even if somebody types the
address in by hand.

Three things always need a manager's PIN at the moment they are done, whoever
is signed in: voiding a line that has already gone to the kitchen,
discounting more than the configured threshold, and reopening a settled bill.
Each is recorded against the manager who approved it, with a reason, and
shows up in Reports → Audit.

---

## 6. Printing

Saba prints through the browser's own print dialogue to any printer the
device can already see. There is no driver and no printer configuration
inside the app.

- **Thermal roll printers (80mm).** Print from a device the printer is
  installed on — a Windows till with the vendor's driver, or a network
  printer the tablet can see. The bill and ticket layouts are designed for
  80mm and fall back gracefully to A4/A5.
- **Set the browser's margins to none** and switch off headers and footers,
  once per device. Otherwise the page number and the URL print on the bill.
- **Kitchen tickets** can be printed the same way, but a screen at the pass
  is better: it shows what is late, and it cannot run out of paper
  mid-service.

---

## 7. Backups

The whole restaurant is one file: `saba.db` in the data directory.

The installer sets up a nightly backup at 04:30 — after the latest a kitchen
closes, before the business day rolls over at 05:00. It writes a complete,
already-compacted copy into `<data>/backups/` and keeps the most recent 14.
It is safe to run while the restaurant is trading.

```sh
node tools/backup.mjs           # take one now
systemctl list-timers saba-backup   # check the nightly one is armed
```

**A backup on the same computer is not a backup.** Copy
`<data>/backups/` somewhere else — a USB stick swapped weekly, a NAS, the
owner's cloud drive, anywhere that is not that machine. A manager can also
pull one straight down from Setup → Backup.

Restoring is in [OPERATIONS.md](OPERATIONS.md#restoring-a-backup).

---

## 8. Upgrading

1. Take a backup. `node tools/backup.mjs`
2. Run `sudo ./install.sh` from the new version, or
   `docker compose build && docker compose up -d`.
3. The database migrates itself on first start, forward only. The installer
   never touches the data directory.

If an upgrade has to be rolled back, restore the backup from step 1 with the
*old* version. A database that has been through a newer schema will refuse to
open on an older build rather than quietly corrupt itself.

### Never seed the demo over real data

`SABA_SEED_DEMO=1` only ever fills a *brand-new, empty* database. On an
install that has taken a single bill it does nothing. The reset in
Setup → Demonstration refuses outright on any database with real trading in
it. Both of those are deliberate, and both are covered by the test suite —
but the habit of taking a backup first is worth more than either.

---

## 9. If it will not start

```sh
systemctl status saba       # is it running
journalctl -u saba -n 50    # why not
journalctl -u saba -f       # watch it
```

| What you see | What it is |
|---|---|
| `EADDRINUSE` | Something else has the port. Change `SABA_PORT`. |
| `Node ... is too old` | Node 22.5+ is needed. `node -v`. |
| Terminals show "cannot reach the till" | The server is down, or the till's address changed. Check §4. |
| `SQLITE_BUSY` | Two servers are running against one database. There must only ever be one. |
| `ExperimentalWarning: SQLite` | Expected, on every start. Node marks its SQLite module experimental; that is why the Docker image pins the Node version. |

The health endpoint answers without a sign-in and is what the Docker health
check uses:

```sh
curl http://localhost:8080/api/health
```

---

## 10. Handing over

Leave the restaurant with:

- the address to open, written down, and bookmarked on every device;
- the manager PIN, changed from the one in the log;
- where the backups go, and who checks them;
- [OPERATIONS.md](OPERATIONS.md), which is written for them rather than for you.
