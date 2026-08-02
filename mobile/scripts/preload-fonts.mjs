/**
 * Adds font preload hints to the exported index.html.
 *
 * WHY
 *
 * Expo loads fonts from inside the JS bundle, via useFonts(). That makes the
 * startup serial: download the 1.6 MB bundle, parse it, execute it, and only
 * then start asking for fonts. Until they arrive the app renders nothing, so
 * the wait is visible on every first visit — and if a font request is blocked
 * (an extension, a filtering proxy, a flaky network), the app used to sit on a
 * blank screen indefinitely.
 *
 * A <link rel="preload"> in the <head> starts those downloads immediately,
 * in parallel with the bundle, so by the time React asks for the fonts they are
 * already in memory. Same fonts, same rendering — the waiting just happens
 * during time the browser was spending anyway.
 *
 * WHY THIS IS A SCRIPT AND NOT A STATIC TEMPLATE
 *
 * Expo will use a project's own public/index.html if one exists, so hand-written
 * preload tags are possible. They would also be wrong within a release: the
 * filenames are content-hashed (HankenGrotesk_400Regular.2e544d61….ttf), so a
 * hardcoded href goes stale the moment a font changes — and it fails silently,
 * because a preload for a URL nobody requests is simply ignored. Reading the
 * real filenames out of the export is the version that cannot rot.
 *
 * The href must match what the app requests, byte for byte, or the browser
 * treats it as an unrelated resource, downloads the font twice, and warns about
 * an unused preload. Hence: derive, never guess.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = 'dist';
const HTML = join(DIST, 'index.html');
const MARKER = 'data-preload="fonts"';

/**
 * Exactly the fonts App.tsx blocks on at startup — no more.
 *
 * Two ways to get this wrong, both of which make things worse rather than
 * better. @expo/vector-icons ships around forty icon families and the app
 * imports one (Ionicons), and the Hanken Grotesk pack exports nine weights
 * where six are used. Preloading the rest would download files nothing renders
 * and log "preloaded but not used" for each — noise that trains you to ignore
 * the console.
 *
 * Keep this list in step with the useFonts() call in App.tsx. The check below
 * fails the build if a name here matches nothing, so a rename surfaces as a
 * failed build rather than a preload that quietly stopped working.
 */
const WANTED = [
  'HankenGrotesk_400Regular',
  'HankenGrotesk_500Medium',
  'HankenGrotesk_600SemiBold',
  'HankenGrotesk_700Bold',
  'HankenGrotesk_800ExtraBold',
  'HankenGrotesk_900Black',
  'Ionicons',
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const all = walk(join(DIST, 'assets')).filter(f => f.endsWith('.ttf'));

// The filename is "<name>.<contenthash>.ttf", so anchor on the name plus the
// dot. Without the dot, "Ionicons" also matches "Ionicons_Regular" and any
// future sibling — and a preload for a font nobody requests is worse than none.
const fonts = WANTED.map(name => {
  const hits = all.filter(f => f.split(sep).pop().startsWith(`${name}.`));
  if (hits.length !== 1) {
    console.error(
      `preload-fonts: expected exactly one file for "${name}", found ${hits.length}.\n` +
      '  The export changed shape or a font was renamed. Update WANTED to match\n' +
      '  the useFonts() call in App.tsx.',
    );
    process.exit(1);
  }
  return hits[0];
});

let html = readFileSync(HTML, 'utf8');

if (html.includes(MARKER)) {
  console.log('preload-fonts: hints already present, nothing to do');
  process.exit(0);
}

// crossorigin is mandatory, not decorative: fonts are always fetched in CORS
// mode, and a preload without it is treated as a different request — so the
// font downloads twice and the preload is wasted.
const links = fonts
  .map(f => `    <link rel="preload" ${MARKER} href="/${relative(DIST, f).split(sep).join('/')}" as="font" type="font/ttf" crossorigin />`)
  .join('\n');

html = html.replace('</head>', `${links}\n  </head>`);
writeFileSync(HTML, html);

console.log(`preload-fonts: added ${fonts.length} hints`);
for (const f of fonts) console.log(`  ${f.split(sep).pop()}`);
