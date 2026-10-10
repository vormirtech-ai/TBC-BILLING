/**
 * The terminal's replica of the restaurant.
 *
 * The server holds the truth. This holds the most recent copy of it, and
 * tells the screens when it changes. There is no local mutation: a command
 * goes to the server, the server broadcasts a new revision, and the replica
 * is refreshed. One direction, one source of truth, nothing to reconcile.
 *
 * Refreshes are coalesced. Firing a course on a busy service can land three
 * revisions in forty milliseconds, and the floor plan should repaint once.
 */

import { api } from '../net/api.js';
import { useCharges } from '../shared/pricing.js';
import { useFloorPlan } from '../shared/floorplan.js';

let data = null;
let revision = -1;
let pending = null;
let inflight = null;

const listeners = new Set();

export const getState = () => data;
export const isReady = () => data !== null;
export const currentRevision = () => revision;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The restaurant's own tax rates and its own floor plan travel with the
 * working set, and every total and every table on every screen is drawn from
 * them. Applying them here, in the one place the replica is replaced, is what
 * stops a terminal costing a bill with yesterday's rates or drawing a room
 * that has been rearranged: there is no path to new data that does not pass
 * through this function.
 */
function adopt(next) {
  data = next;
  useCharges(next?.settings?.charges);
  useFloorPlan(next?.settings?.floorplan);
}

function notify(reason) {
  for (const listener of [...listeners]) {
    try {
      listener(data, reason);
    } catch (error) {
      // One broken screen must not stop the others being told.
      console.error('[saba] a subscriber threw while handling a state change', error);
    }
  }
}

/**
 * Fetch the working set.
 *
 * Concurrent callers share one request: when four screens all notice the
 * same revision bump, that is one fetch, not four.
 */
export function refresh({ reason = 'refresh' } = {}) {
  if (inflight) return inflight;

  inflight = api.state()
    .then((next) => {
      adopt(next);
      revision = next.revision;
      notify(reason);
      return next;
    })
    .finally(() => { inflight = null; });

  return inflight;
}

/**
 * The server says the world is at `next`. Refresh if we are behind.
 *
 * Coalesced on a short timer so a burst of revisions costs one fetch.
 */
export function seenRevision(next, reason) {
  if (typeof next !== 'number' || next <= revision) return;
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    refresh({ reason });
  }, 30);
}

/**
 * Apply an order the server has just handed back.
 *
 * Every command replies with the order it changed, so the terminal that
 * issued it can repaint immediately rather than waiting for its own
 * broadcast to come back around. The other terminals learn about it over the
 * live stream a few milliseconds later.
 */
export function applyOrder(order, nextRevision) {
  if (!data || !order) return;

  const place = (list) => {
    const index = list.findIndex((o) => o.id === order.id);
    if (index >= 0) list[index] = order;
    return index >= 0;
  };

  if (order.status === 'OPEN') {
    if (!place(data.orders)) data.orders.push(order);
    data.settled = data.settled.filter((o) => o.id !== order.id);
  } else if (order.status === 'SETTLED') {
    data.orders = data.orders.filter((o) => o.id !== order.id);
    if (!place(data.settled)) data.settled.unshift(order);
  } else {
    // VOID — a merged-away table, which leaves the floor entirely.
    data.orders = data.orders.filter((o) => o.id !== order.id);
  }

  if (typeof nextRevision === 'number') revision = Math.max(revision, nextRevision);
  notify('command');
}

/** Replace a slice of the replica after a command that is not order-shaped. */
export function patchState(partial, nextRevision) {
  if (!data) return;
  adopt(Object.assign(data, partial));
  if (typeof nextRevision === 'number') revision = Math.max(revision, nextRevision);
  notify('command');
}

export function clear() {
  adopt(null);
  revision = -1;
  if (pending) { clearTimeout(pending); pending = null; }
  notify('cleared');
}
