/**
 * Moves the exported assets out of a directory called "node_modules".
 *
 * THE PROBLEM
 *
 * Expo writes every asset that came from a package under
 * dist/assets/node_modules/… — the fonts, the navigation icons, all of it.
 * Cloudflare Pages does not upload a directory named node_modules, so none of
 * those files exist on the deployed site.
 *
 * What makes this worth a script rather than a note in a README is how it
 * fails. A missing file on Pages does not 404: the SPA fallback answers with
 * index.html and a 200. So the browser asks for a font, receives a small HTML
 * page, and reports success. DevTools shows "200, font, 1.5 kB" and every
 * status looks healthy. The only visible symptom is that text renders in a
 * fallback face and every icon becomes an empty square — which reads like a
 * styling bug, not a missing file, and sent this investigation the wrong way
 * more than once.
 *
 * THE FIX
 *
 * Rename the directory and rewrite the references. The name is the entire
 * problem; nothing else about the layout matters.
 *
 * Rewriting the bundle is a text substitution over the built JavaScript, which
 * deserves a wince — but the alternative is teaching Metro to name that folder
 * differently, and the path is a fixed, unambiguous string ("assets/node_modules/")
 * that appears only as asset URLs. The check at the end fails the build if any
 * reference survives, so a silent partial rewrite is not possible.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, renameSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

const DIST = 'dist';
const FROM = 'assets/node_modules';
const TO = 'assets/vendor';

const fromDir = join(DIST, ...FROM.split('/'));
const toDir = join(DIST, ...TO.split('/'));

if (!existsSync(fromDir)) {
  // Already relocated (a re-run), or a future Expo stopped using the name.
  // Either way there is nothing to do and nothing to warn about.
  console.log('relocate-vendor-assets: nothing to move');
  process.exit(0);
}
if (existsSync(toDir)) {
  console.error(`relocate-vendor-assets: ${toDir} already exists — refusing to merge into it`);
  process.exit(1);
}

renameSync(fromDir, toDir);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// index.html holds the preload hints and the script tag; the bundle holds every
// asset URL the app resolves at runtime. Both reference the old path.
const targets = [join(DIST, 'index.html'), ...walk(join(DIST, '_expo')).filter(f => f.endsWith('.js'))];

let rewritten = 0;
for (const file of targets) {
  const before = readFileSync(file, 'utf8');
  const after = before.split(FROM).join(TO);
  if (after !== before) {
    writeFileSync(file, after);
    rewritten += 1;
  }
}

// A reference left behind would be a 200-with-HTML at runtime — the exact
// silent failure this script exists to remove. Fail the build instead.
const stragglers = targets.filter(f => readFileSync(f, 'utf8').includes(FROM));
if (stragglers.length) {
  console.error(`relocate-vendor-assets: ${FROM} still referenced in:\n  ${stragglers.join('\n  ')}`);
  process.exit(1);
}

console.log(`relocate-vendor-assets: ${FROM} -> ${TO}, rewrote ${rewritten} file(s)`);
