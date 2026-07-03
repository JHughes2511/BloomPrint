// Extracts a short, descriptive subject from an AI report body — the player
// name (+ level) for player reports, or the best title line (team matchup /
// scheme) for team reports. Lines that just echo the report type are rejected.
// Used anywhere a report needs a human title beyond its generic type label.
import { outputTypeLabel } from './reportType';

const LEVEL_RE = /\b(HS Varsity|HS JV|Varsity|JUCO|NAIA|D1|D2|D3|College|Pro|AAU|Middle School|Youth|EYBL|Prep)\b/i;
const SKIP_TITLE = /^(bim\b|player\b|program\b|framework\b|overall\b|grade\b|evaluation\b|status\b|rating\b|section\b|output\b|\d+\s+frames|rating scale|status options|comparable|floor comp|ceiling comp)/i;

const cleanLine = (l: string) =>
  l.replace(/\*\*/g, '').replace(/^#{1,6}\s*/, '').replace(/[—–_=]{2,}/g, '').trim();

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export const reportSubject = (reportText: string | null | undefined, outputType: string): string | null => {
  if (!reportText) return null;
  const typeNorm = norm(outputTypeLabel(outputType) || '');
  const head = reportText.split('\n').map(cleanLine).filter(Boolean).slice(0, 18);

  const playerLine = head.find(l => /^player\s*:/i.test(l));
  if (playerLine) {
    const name = playerLine.replace(/^player\s*:/i, '').split('/')[0].trim();
    if (name) {
      const lm = head.join(' ').match(LEVEL_RE);
      const level = lm ? lm[1] : '';
      return level && !name.toLowerCase().includes(level.toLowerCase()) ? `${name} · ${level}` : name;
    }
  }

  const candidates = head
    .filter((l, i) =>
      i > 0 &&
      l.length >= 6 && l.length <= 80 &&
      /[a-z]/.test(l) &&
      !SKIP_TITLE.test(l) &&
      !/:/.test(l.slice(0, 26)) &&
      norm(l) !== typeNorm && !norm(l).includes(typeNorm),
    )
    .map(l => l.split(/\s+[—–-]\s+/)[0].replace(/\s*\|.*$/, '').trim())
    .filter(s => s.length >= 4 && norm(s) !== typeNorm && !norm(s).includes(typeNorm));

  return candidates.find(s => /\bvs?\.?\b/i.test(s)) || candidates[0] || null;
};
