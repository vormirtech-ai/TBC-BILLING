/**
 * The published demonstration.
 *
 * This is the only file the demonstration adds. It stands a till up inside
 * the tab, says plainly on screen that it has done so, and then boots the
 * ordinary application — which from that point on is byte-for-byte the
 * software a restaurant installs.
 */

import { install, till } from './net/till/index.js';
import { DEMO_STAFF } from './net/till/seed.js';

install();

/**
 * A line across the top, so nobody can mistake this for the product running
 * somewhere real. It names the PINs too: a showroom door should not be
 * locked, and there is nothing behind it to protect.
 */
function banner() {
  const bar = document.createElement('div');
  bar.className = 'demobar';
  bar.innerHTML = `
    <span class="demobar__dot" aria-hidden="true"></span>
    <strong>Demonstration.</strong>
    <span class="demobar__text">
      Everything runs in this tab and is forgotten when you close it.
      Sign in as <b>Manager 1379</b>, <b>Captain 2471</b>,
      <b>Cashier 3582</b> or <b>Kitchen 4693</b>.
    </span>
    <button class="demobar__reset" type="button">Start again</button>
    <a class="demobar__back" href="../">About Saba</a>
  `;
  bar.querySelector('.demobar__reset').addEventListener('click', () => {
    window.location.reload();
  });
  document.body.appendChild(bar);
  document.body.classList.add('has-demobar');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', banner, { once: true });
} else {
  banner();
}

// The real entry point, untouched.
import('./main.js');

export { till, DEMO_STAFF };
