// Turn an AI-generated training program into something a player can tick off.
//
// The checklist follows the program. A coach who writes by day of the week gets
// a day per row; one who writes in phases, blocks or weeks gets those; one who
// writes a flat list of drills gets the drills. The shape is the coach's, not
// this file's.
//
// It did not used to be. The parser read one section, "Weekly Structure
// Overview", and made a row from any line starting with a day name. Everything
// else in the program was invisible to it, so a program organised by phase
// produced no checklist at all — just prose, with nothing to tick and no sign
// that anything was missing. A fortnight's program fared worse: rows were keyed
// by day name, so the second Monday was read as a duplicate of the first and
// dropped, and a player working through week two saw 7/7 while half the work
// was unlisted.
//
// KEYS ARE PROMISES
//
// A ticked item is stored by key in completed_drills. Change how a key is
// derived and every player mid-program silently loses their progress, because
// the stored keys stop matching anything on screen. So the day path below
// produces exactly the keys it always did, and repeats are qualified rather
// than renumbered — the first Monday keeps its old key and only the second one
// gets a new one.

export interface Drill {
  key: string;
  label: string;
  meta?: string;
  /**
   * What the program says under this item, verbatim.
   *
   * The rows carry a label and at most a line of summary, and everything that
   * says what the work actually is lived further down the page. A player had to
   * leave the checklist, find the right part of the program and come back. This
   * is those lines, so the row can open where it stands. Not a rewrite of them:
   * a second version of the same words is a second version to keep in step.
   */
  detail: string[];
}
export interface DrillSection { title: string; drills: Drill[] }

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_WORD = new RegExp(`\\b(${DAYS.join('|')})\\b`, 'i');
const DAY_AT_START = new RegExp(`^(${DAYS.join('|')})\\b[\\s:.—–-]*(.*)$`, 'i');

// Heading that begins the weekly structure overview section.
const WEEKLY_HEADING = /weekly\s+(structure|overview|session|plan|schedule|breakdown)/i;
// Headings that mark the start of a different (non-weekly) section — stop here.
const END_SECTION = /^(pillar\b|month\b|phase\b|macro\b|progression|integration timeline|notes\b|coach notes|kpi\b|metric|appendix|tracking|checkpoint|priorit)/i;

// Sections that describe the plan rather than being it. A player cannot tick
// off "notes" or "how progress is measured", and putting them on the list makes
// the count meaningless.
const NOT_WORK = /^(notes?|coach notes|kpi|metrics?|appendix|tracking|measurement|progress(ion)? (tracking|markers)|checkpoints?|summary|overview|introduction|goals?|objectives?|key takeaways?|priorit)/i;

// A long program should not become a hundred-line checklist nobody finishes.
const MAX_ITEMS = 60;

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

const clean = (s: string) =>
  s.replace(/\*\*/g, '').replace(/[`*]/g, '').replace(/^#{1,6}\s*/, '').trim();

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

const findDuration = (s: string) => {
  const m = s.match(/\d+\s*(?:min|hr|hour)[^)]*/i);
  return m ? m[0].replace(/[()]/g, '').replace(/\s+/g, ' ').trim() : '';
};

const isBullet = (raw: string) => /^\s*[-•*]\s+/.test(raw) || /^\s*\d+[.)]\s+/.test(raw);

const indentOf = (raw: string) => (raw.match(/^\s*/) as RegExpMatchArray)[0].length;

/** Trim the detail so one runaway section cannot fill the screen. */
const MAX_DETAIL = 12;

function trimDetail(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const t = clean(l);
    if (!t) continue;
    const item = stripMarker(t);
    if (!item) continue;
    out.push(item);
    if (out.length >= MAX_DETAIL) break;
  }
  return out;
}

// Deliberately two strippers.
//
// stripBullet is what the day path has always used, and the focus text it
// produces feeds that path's keys. Correcting it would change keys for any
// program whose day heading carried no focus, which is a player's ticks gone.
// It stays as it is.
const stripBullet = (s: string) => s.replace(/^[-•*\d.)\s]+/, '').trim();

// stripMarker is the correct one: a list marker is a dash, a dot, or a number
// FOLLOWED by a dot or bracket. A bare leading digit is part of what was
// written, and eating it turned "3 sets of pound dribble" into "sets of pound
// dribble". Used by the structure path, which is new and has no keys to keep,
// and by the detail, which feeds no keys at all.
const stripMarker = (s: string) => s.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim();

/** A heading in the house style: ALL CAPS ending with a colon, or a markdown one. */
function headingOf(raw: string): string | null {
  const line = clean(raw);
  if (!line || isBullet(raw)) return null;
  if (/^#{1,6}\s/.test(raw.trim())) return line.replace(/:$/, '').trim() || null;
  if (!line.endsWith(':')) return null;
  const words = line.slice(0, -1).trim();
  if (!words || words.length > 70) return null;
  // ALL CAPS is the house style. Title Case headings appear too, so accept a
  // line that carries no lowercase letters, or a short one that starts capital.
  const letters = words.replace(/[^A-Za-z]/g, '');
  if (letters && letters === letters.toUpperCase()) return words;
  return null;
}

/**
 * A one-line summary of a day's session, built from the bullets under it.
 *
 * Programs vary: some name the day's focus on the heading line, some just write
 * "MONDAY" and list the work beneath. This covers the second kind — it reads
 * forward until the next day or section and joins what it finds, so the row
 * says what the player is actually doing.
 */
function describeFrom(lines: string[], from: number): string {
  const parts: string[] = [];
  for (let i = from; i < lines.length && parts.length < 3; i++) {
    const line = clean(lines[i]);
    if (!line) continue;
    if (DAY_AT_START.test(line) || END_SECTION.test(line) || WEEKLY_HEADING.test(line)) break;
    const item = stripBullet(line);
    if (!item || item.length > 80) continue;
    // Drop a trailing duration — it is shown separately.
    parts.push(item.replace(/\s*[—–-]?\s*\(?\d+\s*(?:min|hr|hour)s?\)?\s*$/i, '').trim());
  }
  return parts.filter(Boolean).join(' · ');
}

/** The original day-of-week reading, kept key-for-key. */
function parseByDay(lines: string[]): Drill[] {
  const start = lines.findIndex(l => WEEKLY_HEADING.test(clean(l)));
  if (start < 0) return [];

  const seen = new Map<string, number>();
  const drills: Drill[] = [];

  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    const line = clean(raw);
    if (!line) continue;
    if (END_SECTION.test(line)) break;

    let day = '';
    let focus = '';
    let duration = '';

    if (raw.includes('|')) {
      const cells = raw.split('|').map(clean).filter(Boolean);
      const di = cells.findIndex(c => DAY_WORD.test(c) && c.length < 16);
      if (di < 0) continue;
      day = (cells[di].match(DAY_WORD) as RegExpMatchArray)[1];
      focus = cells[di + 1] || '';
      duration = cells.slice(di + 1).map(findDuration).find(Boolean) || '';
    } else {
      const m = line.match(DAY_AT_START);
      if (!m) continue;
      day = m[1];
      const rest = m[2].trim();
      duration = findDuration(rest);
      focus = rest.replace(/\(?\b\d+\s*(?:min|hr|hour)[^)]*\)?/i, '').replace(/^[—–-]\s*/, '').trim();
    }

    const dayCap = cap(day);
    if (!focus) focus = describeFrom(lines, i + 1);

    // Everything written under this day, up to the next day or section.
    const under: string[] = [];
    if (!raw.includes('|')) {
      for (let j = i + 1; j < lines.length; j++) {
        const nxt = clean(lines[j]);
        if (!nxt) continue;
        if (DAY_AT_START.test(nxt) || END_SECTION.test(nxt) || WEEKLY_HEADING.test(nxt)) break;
        under.push(lines[j]);
      }
    }

    // A program longer than a week says "Monday" again. It used to be dropped,
    // taking the whole of week two off the list. The first keeps the key it has
    // always had so ticks survive; later ones are qualified.
    const times = (seen.get(dayCap) ?? 0) + 1;
    seen.set(dayCap, times);
    const base = slug(`${dayCap}-${focus || 'day'}`);

    drills.push({
      key: times === 1 ? base : `${base}-${times}`,
      label: times === 1 ? dayCap : `${dayCap} (${times})`,
      meta: [focus, duration].filter(Boolean).join(' · ') || undefined,
      detail: trimDetail(under),
    });
    if (drills.length >= MAX_ITEMS) break;
  }
  return drills;
}

/**
 * The program's own shape: whatever the coach organised it by.
 *
 * Every heading that describes work becomes a section, and the bullets under it
 * become its items. A program with no headings at all is read as one flat list,
 * which is what a coach who writes ten drills and nothing else expects to tick.
 */
function parseByStructure(lines: string[]): DrillSection[] {
  const sections: DrillSection[] = [];
  let current: DrillSection | null = null;
  let count = 0;
  // Distinct from `current === null`. Inside a commentary section we are
  // ignoring bullets on purpose; before the first heading we are collecting
  // them. Conflating the two filed "rest if the knee flares up" as a drill.
  let skipping = false;
  let sawHeading = false;
  const used = new Set<string>();

  const push = (title: string) => {
    current = { title, drills: [] };
    sections.push(current);
  };

  for (let idx = 0; idx < lines.length; idx++) {
    if (count >= MAX_ITEMS) break;
    const raw = lines[idx];
    const line = clean(raw);
    if (!line) continue;

    const heading = headingOf(raw);
    if (heading) {
      sawHeading = true;
      // Commentary sections are readable in the program and pointless on a
      // checklist, so they end the current section without starting one.
      skipping = NOT_WORK.test(heading);
      if (skipping) current = null;
      else push(heading);
      continue;
    }
    if (skipping) continue;
    if (!isBullet(raw)) continue;
    if (!current) {
      // Bullets before any heading are still work. They get an unnamed section
      // rather than being thrown away. After a heading has been seen there is
      // no such case: a bullet is either under a section or under a skipped one.
      if (sawHeading) continue;
      push('');
    }
    const item = stripMarker(line);
    if (!item || item.length > 120) continue;
    const duration = findDuration(item);
    const label = item.replace(/\s*\(?\b\d+\s*(?:min|hr|hour)s?\)?\s*$/i, '').trim() || item;

    let key = slug(`${current!.title}-${label}`) || slug(label);
    let n = 1;
    while (used.has(key)) key = `${key}-${++n}`;
    used.add(key);

    // What sits under this bullet: anything indented beneath it, and any prose
    // that follows before the next item. A sibling bullet or a heading ends it.
    const own = indentOf(raw);
    const under: string[] = [];
    let j = idx + 1;
    for (; j < lines.length; j++) {
      const nxt = lines[j];
      if (!clean(nxt)) continue;
      if (headingOf(nxt)) break;
      if (isBullet(nxt) && indentOf(nxt) <= own) break;
      under.push(nxt);
    }
    // Past them, not over them. A sub-bullet is what this item involves, and
    // leaving the cursor behind listed every one of them as its own row to tick
    // as well as showing it inside the row above.
    idx = j - 1;

    current!.drills.push({ key, label, meta: duration || undefined,
                           detail: trimDetail(under) });
    count++;
  }
  return sections.filter(s => s.drills.length);
}

export function parseDrills(text?: string | null): { sections: DrillSection[]; total: number } {
  if (!text) return { sections: [], total: 0 };
  const lines = text.split('\n');

  // The day reading comes first and unchanged, so a program already in a
  // player's hands keeps the exact rows and keys it had.
  const byDay = parseByDay(lines);
  if (byDay.length) {
    return { sections: [{ title: 'Weekly Structure', drills: byDay }], total: byDay.length };
  }

  const structured = parseByStructure(lines);
  const total = structured.reduce((n, s) => n + s.drills.length, 0);
  return total ? { sections: structured, total } : { sections: [], total: 0 };
}
