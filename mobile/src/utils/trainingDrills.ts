// Parse an AI-generated training program into a checkable weekly plan. The
// checkable items come ONLY from the program's "Weekly Structure Overview" — the
// per-day plan — which appears in one of two formats:
//   1. a markdown table (Day | Focus | Duration), or
//   2. day-of-week headings ("MONDAY — Iso Sequencing, Contact Counters …").
// Each day of the week becomes one checkable task, so progress reads like "4/7".

export interface Drill { key: string; label: string; meta?: string }
export interface DrillSection { title: string; drills: Drill[] }

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_WORD = new RegExp(`\\b(${DAYS.join('|')})\\b`, 'i');
const DAY_AT_START = new RegExp(`^(${DAYS.join('|')})\\b[\\s:.—–-]*(.*)$`, 'i');

// Heading that begins the weekly structure overview section.
const WEEKLY_HEADING = /weekly\s+(structure|overview|session|plan|schedule|breakdown)/i;
// Headings that mark the start of a different (non-weekly) section — stop here.
const END_SECTION = /^(pillar\b|month\b|phase\b|macro\b|progression|integration timeline|notes\b|coach notes|kpi\b|metric|appendix|tracking|checkpoint|priorit)/i;

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

const clean = (s: string) =>
  s.replace(/\*\*/g, '').replace(/[`*]/g, '').replace(/^#{1,6}\s*/, '').trim();

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

const findDuration = (s: string) => {
  const m = s.match(/\d+\s*(?:min|hr|hour)[^)]*/i);
  return m ? m[0].replace(/[()]/g, '').replace(/\s+/g, ' ').trim() : '';
};

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
    // Bullets and numbered items are the session; prose headings are not.
    const item = line.replace(/^[-•*\d.)\s]+/, '').trim();
    if (!item || item.length > 80) continue;
    // Drop a trailing duration — it is shown separately.
    parts.push(item.replace(/\s*[—–-]?\s*\(?\d+\s*(?:min|hr|hour)s?\)?\s*$/i, '').trim());
  }
  return parts.filter(Boolean).join(' · ');
}

export function parseDrills(text?: string | null): { sections: DrillSection[]; total: number } {
  if (!text) return { sections: [], total: 0 };
  const lines = text.split('\n');

  // Locate the weekly structure overview.
  const start = lines.findIndex(l => WEEKLY_HEADING.test(clean(l)));
  if (start < 0) return { sections: [], total: 0 };

  const seen = new Set<string>();
  const drills: Drill[] = [];

  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    const line = clean(raw);
    if (!line) continue;
    if (END_SECTION.test(line)) break; // reached a different section

    let day = '';
    let focus = '';
    let duration = '';

    if (raw.includes('|')) {
      // Markdown table row: | **Monday** | Focus | 90 min |
      const cells = raw.split('|').map(clean).filter(Boolean);
      const di = cells.findIndex(c => DAY_WORD.test(c) && c.length < 16);
      if (di < 0) continue;
      day = (cells[di].match(DAY_WORD) as RegExpMatchArray)[1];
      focus = cells[di + 1] || '';
      duration = cells.slice(di + 1).map(findDuration).find(Boolean) || '';
    } else {
      // Day-of-week heading: "MONDAY — Iso Sequencing, Contact Counters …"
      const m = line.match(DAY_AT_START);
      if (!m) continue;
      day = m[1];
      const rest = m[2].trim();
      duration = findDuration(rest);
      focus = rest.replace(/\(?\b\d+\s*(?:min|hr|hour)[^)]*\)?/i, '').replace(/^[—–-]\s*/, '').trim();
    }

    const dayCap = cap(day);
    if (seen.has(dayCap)) continue;
    seen.add(dayCap);

    // A day with no focus text of its own: describe it from the lines that
    // follow, which is where the drills live. Without this the row read
    // "Monday" over "Monday" — the day printed twice and nothing said.
    if (!focus) focus = describeFrom(lines, i + 1);

    // The day is the title and the session is the description under it. The
    // other way round put the day in small grey type under a heading that was
    // sometimes the day again.
    drills.push({
      key: slug(`${dayCap}-${focus || 'day'}`),
      label: dayCap,
      meta: [focus, duration].filter(Boolean).join(' · ') || undefined,
    });
  }

  if (!drills.length) return { sections: [], total: 0 };
  return { sections: [{ title: 'Weekly Structure', drills }], total: drills.length };
}
