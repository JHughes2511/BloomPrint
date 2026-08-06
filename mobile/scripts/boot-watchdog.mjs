/**
 * Adds a boot watchdog to the exported index.html.
 *
 * WHY
 *
 * The page can load and the app never start. The usual cause is a stale HTML:
 * every build content-hashes its bundle, so an index.html held in a browser
 * cache after a deploy asks for a file that is no longer there, the script
 * 404s, and what is left is a page with nothing on it. Reloading re-reads the
 * same cached HTML and fails identically — which is why the only way out was
 * closing the browser entirely.
 *
 * _headers stops the caching that causes it. This is the seatbelt: if React has
 * not mounted after a generous wait, reload once with a cache-busting query so
 * the browser is forced to fetch fresh HTML. Once, not repeatedly — a reload
 * loop is worse than a blank page, so the attempt is recorded in sessionStorage
 * and cleared only after a load that actually rendered something.
 *
 * WHY THIS IS A SCRIPT AND NOT A STATIC TEMPLATE
 *
 * Same reason as preload-fonts: Expo generates index.html on every export, and
 * a hand-maintained copy in public/ would have to be kept in step with whatever
 * Expo emits. Editing the output leaves one source of truth.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const INDEX = path.join(DIST, 'index.html');
const MARKER = 'bloomprint-boot-watchdog';

/** How long to let the app start before assuming it never will. */
const GRACE_MS = 12000;

const SCRIPT = `<script id="${MARKER}">
(function () {
  var KEY = 'bloomprint-boot-retry';
  function mounted() {
    var r = document.getElementById('root');
    return !!(r && r.childElementCount > 0);
  }
  // A load that worked clears the flag, so a failure weeks later can still
  // heal itself rather than being locked out by one old attempt.
  setTimeout(function () { if (mounted()) { try { sessionStorage.removeItem(KEY); } catch (e) {} } }, 4000);
  setTimeout(function () {
    if (mounted()) return;
    try {
      if (sessionStorage.getItem(KEY)) return;   // already tried; do not loop
      sessionStorage.setItem(KEY, '1');
    } catch (e) { return; }                      // no storage, no retry
    // The query is the point: it is what a cached HTML response cannot match.
    var u = location.pathname + (location.search ? location.search + '&' : '?') + 'boot=' + Date.now();
    location.replace(u);
  }, ${GRACE_MS});
})();
</script>`;

let html = fs.readFileSync(INDEX, 'utf8');

if (html.includes(MARKER)) {
  console.log('boot-watchdog: already present');
} else {
  html = html.replace('</head>', `${SCRIPT}\n  </head>`);
  fs.writeFileSync(INDEX, html);
  console.log(`boot-watchdog: added (${GRACE_MS}ms grace)`);
}
