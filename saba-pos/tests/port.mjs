/**
 * One port counter for the whole suite.
 *
 * Every suite that starts a real server needs a port nobody else is using.
 * They used to pick their own random base and count up from it, and the
 * ranges overlapped: on an unlucky run two suites would choose the same
 * number, the second server would fail to bind, and a test somewhere else
 * would report "fetch failed" with no clue why.
 *
 * The suites run one at a time in one process, so one shared counter is all
 * it takes, and a single random offset keeps it clear of whatever else the
 * machine happens to be running.
 */

let next = 9300 + Math.floor(Math.random() * 400);

export const nextPort = () => (next += 1);
