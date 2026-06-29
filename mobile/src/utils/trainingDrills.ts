// Parse an AI-generated training program (freeform text) into checkable drills
// grouped by section, so the player can track completion. Keys are derived from
// the drill text so they stay stable across reloads (and naturally reset when a
// program is regenerated with different drills).

export interface Drill { key: string; label: string; meta?: string }
export interface DrillSection { title: string; drills: Drill[] }

const CATEGORY_WORDS: [RegExp, string][] = [
  [/form shooting|catch.?and.?shoot|jumper|free throw|\bshoot/i, 'Shooting'],
  [/ball.?handl|dribbl|\bhandle/i, 'Ball Handling'],
  [/defens|closeout|lateral slide|on-ball|help.?side/i, 'Defense'],
  [/condition|sprint|agility|footwork/i, 'Conditioning'],
  [/\bpass|vision/i, 'Passing'],
  [/finish|layup|\brim|post|combo|scoring|offens/i, 'Offense'],
  [/strength|weight|\blift|core/i, 'Strength'],
];

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

const isDrillLine = (line: string) => /^\s*([-*•·▪]|\d+[.)])\s+/.test(line);

const isHeading = (line: string): boolean => {
  const s = line.trim();
  if (!s) return false;
  if (/^day\s*\d/i.test(s) || /^week\s*\d/i.test(s)) return true;
  const cleaned = s.replace(/\*\*/g, '').replace(/:$/, '').trim();
  const allCaps = /[A-Z]/.test(cleaned) && /^[A-Z0-9][A-Z0-9\s/&\-—().,':+]+$/.test(cleaned);
  const shortColon = cleaned.length < 50 && s.endsWith(':');
  return allCaps || shortColon;
};

// Checkable drills come ONLY from the program's weekly structure overview. That
// region STARTS at a "Weekly … / Session Plan" heading and CONTINUES through its
// per-day blocks; it ENDS at the next unrelated section. Standalone day/workout/
// routine sections elsewhere, KPI targets, checkpoints, profile, and prose are
// all excluded.
const WEEKLY_START = /weekly|week\s*\d|session\s*plan/i;
const WEEKLY_CONTINUE = /^day\s*\d|^week\s*\d/i;

// Individual lines that are commentary/metrics rather than a drill.
const SKIP_LINE = /[↑↓]|^\s*\d+\s*[-–]?\s*week\b|measurably|^link\b|should be|^\s*by (week|day)\b/i;

export function parseDrills(text?: string | null): { sections: DrillSection[]; total: number } {
  if (!text) return { sections: [], total: 0 };
  const sections: DrillSection[] = [];
  let cur: DrillSection | null = null;
  let collecting = false;
  const seen = new Set<string>();
  let total = 0;

  for (const raw of text.split('\n')) {
    if (isDrillLine(raw)) {
      if (!collecting || !cur) continue;
      if (SKIP_LINE.test(raw)) continue;
      const label = raw
        .replace(/^\s*([-*•·▪]|\d+[.)])\s+/, '')
        .replace(/\*\*/g, '').replace(/`/g, '').trim();
      if (label.length < 4) continue;

      const timeM = label.match(/(\d+\s*[–-]?\s*\d*\s*min)/i);
      const time = timeM ? timeM[1].replace(/\s+/g, ' ').trim() : '';
      let category = '';
      for (const [re, cat] of CATEGORY_WORDS) {
        if (re.test(label) || (cur && re.test(cur.title))) { category = cat; break; }
      }
      const meta = [category, time].filter(Boolean).join(' · ');

      let key = slug(label) || `drill-${total}`;
      if (seen.has(key)) key = `${key}-${total}`;
      seen.add(key);

      cur.drills.push({ key, label, meta: meta || undefined });
      total++;
    } else if (isHeading(raw)) {
      const title = raw.trim().replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').replace(/:$/, '').trim();
      if (WEEKLY_START.test(title)) {
        collecting = true;                        // entering the weekly structure
        cur = { title, drills: [] };
        sections.push(cur);
      } else if (collecting && WEEKLY_CONTINUE.test(title)) {
        cur = { title, drills: [] };              // a day block within the week
        sections.push(cur);
      } else {
        collecting = false;                       // left the weekly structure
        cur = null;
      }
    }
  }

  return { sections: sections.filter(s => s.drills.length), total };
}
