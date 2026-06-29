// Parsing helpers that turn an AI-generated plain-text report into the pieces
// the redesigned report detail screen renders: a short brief (TL;DR), a small
// set of broken-out "fixed" sections per report type, and a derived recruit
// grade. The full raw report is still available verbatim (shown in a dropdown).

export interface ReportSegment {
  heading: string; // normalized heading (no markdown, no trailing colon)
  body: string;
}

const isHeadingLine = (raw: string): boolean => {
  const s = raw.trim();
  if (!s) return false;
  if (/^#{1,6}\s/.test(s)) return true;
  const cleaned = s.replace(/\*\*/g, '').trim();
  // ALL-CAPS title line (allows digits, punctuation, em-dash)
  const isAllCaps =
    /[A-Z]/.test(cleaned) && /^[A-Z0-9][A-Z0-9\s/&\-—().,':+]+$/.test(cleaned);
  // Short label line ending with a colon (e.g. "Offense — Strengths:")
  const isShortColon = cleaned.length < 60 && cleaned.endsWith(':');
  return isAllCaps || isShortColon;
};

const normalizeHeading = (raw: string): string =>
  raw
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/:\s*$/, '')
    .trim();

/** Split a report into heading/body segments by its plain-text section headers. */
export function splitSections(text?: string | null): ReportSegment[] {
  if (!text) return [];
  const out: ReportSegment[] = [];
  let cur: ReportSegment | null = null;
  for (const raw of text.split('\n')) {
    if (isHeadingLine(raw)) {
      cur = { heading: normalizeHeading(raw), body: '' };
      out.push(cur);
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + raw;
    } else if (raw.trim()) {
      cur = { heading: '', body: raw };
      out.push(cur);
    }
  }
  return out.map(s => ({ heading: s.heading, body: s.body.trim() }));
}

/** The 2–3 sentence executive summary the model emits under a "BRIEF:" header. */
export function extractBrief(text?: string | null): string | null {
  if (!text) return null;
  const seg = splitSections(text).find(s => /^brief\b/i.test(s.heading));
  if (seg && seg.body.trim()) return seg.body.trim();
  // Fallbacks for reports generated before the brief directive existed.
  const m = text.match(/one[-\s]?line summary\s*:?\s*(.+)/i);
  if (m && m[1].trim()) return m[1].trim();
  return null;
}

// ── Recruit grade — derived from the 0–10 overall grade ────────────────────────

export interface RecruitGrade {
  letter: string;
  tier: string;
  blurb: string;
}

const RECRUIT_LADDER: { min: number; letter: string; tier: string; blurb: string }[] = [
  { min: 9.0, letter: 'A+', tier: 'Elite · High-Major', blurb: 'Top-tier prospect. High-major recruitable talent with pro upside.' },
  { min: 8.0, letter: 'A',  tier: 'High-Major',         blurb: 'High-major recruitable. Projects as a rotation-or-better at the top level.' },
  { min: 7.0, letter: 'B+', tier: 'Mid-Major',          blurb: 'Strong mid-major target with a path toward high-major with development.' },
  { min: 6.0, letter: 'B',  tier: 'Mid-Major · Low-Major', blurb: 'Solid mid/low-major contributor. Recruitable role player.' },
  { min: 5.0, letter: 'C+', tier: 'Low-Major · JUCO',   blurb: 'Low-major or JUCO level. Developmental upside worth monitoring.' },
  { min: 4.0, letter: 'C',  tier: 'JUCO · Developmental', blurb: 'Developmental prospect. Needs measurable growth to recruit up.' },
  { min: 0.0, letter: 'D',  tier: 'Developmental',       blurb: 'Early-stage developmental profile. Re-evaluate after focused training.' },
];

export function recruitGrade(grade?: number | null): RecruitGrade | null {
  if (grade == null || isNaN(grade)) return null;
  const row = RECRUIT_LADDER.find(r => grade >= r.min) ?? RECRUIT_LADDER[RECRUIT_LADDER.length - 1];
  return { letter: row.letter, tier: row.tier, blurb: row.blurb };
}

/** Full ladder for the "how this maps" detail popup. */
export const recruitGradeScale = RECRUIT_LADDER.map(r => ({
  letter: r.letter,
  tier: r.tier,
  range: r.min >= 9 ? '9.0 – 10' : `${r.min.toFixed(1)} – ${(r.min + 0.9).toFixed(1)}`,
}));

// ── Fixed broken-out sections per report type ──────────────────────────────────

export interface FixedSection {
  key: string;
  label: string;
  icon: string; // Ionicons name
  tone: 'label' | 'brown';
  body: string;
}

interface FixedSectionDef {
  key: string;
  label: string;
  icon: string;
  tone: 'label' | 'brown';
  match: RegExp;
}

const FIXED_DEFS: Record<string, FixedSectionDef[]> = {
  scouting_report: [
    { key: 'offense', label: 'Offensive Skills', icon: 'basketball-outline', tone: 'label', match: /offens|scoring|shoot|elite skill/i },
    { key: 'defense', label: 'Defense',          icon: 'shield-outline',     tone: 'label', match: /defens/i },
    { key: 'projection', label: 'Projection',    icon: 'flag-outline',       tone: 'brown', match: /projection|rating|status|comp|recruit|outlook|mental|intel|physical|medical|key question|3-year|development/i },
  ],
};

const singleType = (outputType?: string | null): string =>
  (outputType ?? '').split(',').map(s => s.trim()).filter(Boolean)[0] ?? '';

/**
 * Build the fixed broken-out sections for a report type by bucketing the
 * report's parsed segments. Returns null when the type has no fixed layout or
 * none of its buckets gathered any content (caller falls back to full report).
 */
export function getFixedSections(outputType: string | null | undefined, text?: string | null): FixedSection[] | null {
  const defs = FIXED_DEFS[singleType(outputType)];
  if (!defs || !text) return null;

  const buckets = defs.map(d => ({ def: d, parts: [] as string[] }));
  for (const seg of splitSections(text)) {
    if (!seg.heading || /^brief\b/i.test(seg.heading)) continue;
    if (!seg.body) continue;
    for (const b of buckets) {
      if (b.def.match.test(seg.heading)) {
        const subLabel = seg.heading.replace(/^section\s*\d+\s*[—-]\s*/i, '').trim();
        b.parts.push(subLabel ? `${subLabel}: ${seg.body}` : seg.body);
        break;
      }
    }
  }

  const result = buckets.map(b => ({
    key: b.def.key,
    label: b.def.label,
    icon: b.def.icon,
    tone: b.def.tone,
    body: b.parts.join('\n\n'),
  }));

  return result.some(s => s.body.trim()) ? result : null;
}
