// Game-clock / period structure tied to competition level.
//
// The grade weighting always uses FOUR buckets (Q1/Q2 ×1.0, Q3 ×1.25, Q4 ×1.5,
// OT ×1.5). For quarter games each quarter is a bucket; for half games each half
// is split into two equal time buckets (so a 20-min college half flips at 10:00,
// a 16-min AAU half at 8:00). The derived bucket is what we send as `quarter`, so
// the entire existing backend weight pipeline works unchanged.

export type PeriodFormat = 'quarters' | 'halves';

export interface GameFormat {
  format: PeriodFormat;
  numPeriods: number;      // 4 quarters, or 2 halves
  periodSeconds: number;   // length of one period
  otSeconds?: number;      // length of one overtime; a full period if unset
}

const QUARTERS = (mins: number): GameFormat => ({ format: 'quarters', numPeriods: 4, periodSeconds: mins * 60 });
const HALVES = (mins: number): GameFormat => ({ format: 'halves', numPeriods: 2, periodSeconds: mins * 60 });

// Competition level → default game format.
export function formatForLevel(level?: string | null): GameFormat {
  switch ((level || '').trim()) {
    case 'NBA':
    case 'G-League':
      return QUARTERS(12);
    case 'D1':
    case 'D2':
    case 'D3':
    case 'JUCO':
      return HALVES(20);
    case '17U AAU':
    case '16U AAU':
    case '14U/15U AAU':
      return HALVES(16);
    case 'Youth (5-13)':
      return QUARTERS(6);
    case 'High Europe':
    case 'Low Europe':
    case 'European Pro':
    case 'International Academy':
      return QUARTERS(10);
    case 'HS Varsity':
    default:
      return QUARTERS(8);
  }
}

// Overtime length by level. NBA, G-League, college and FIBA play 5 minutes;
// high school (NFHS) plays 4. AAU and youth vary by event: 4 and 3 are the
// defaults, and the clock can be edited on the day.
export function overtimeSecondsForLevel(level?: string | null): number {
  switch ((level || '').trim()) {
    case 'NBA':
    case 'G-League':
    case 'D1':
    case 'D2':
    case 'D3':
    case 'JUCO':
    case 'High Europe':
    case 'Low Europe':
    case 'European Pro':
    case 'International Academy':
      return 5 * 60;
    case '17U AAU':
    case '16U AAU':
    case '14U/15U AAU':
      return 4 * 60;
    case 'Youth (5-13)':
      return 3 * 60;
    case 'HS Varsity':
    default:
      return 4 * 60;
  }
}

// How long a period runs: an overtime runs its own, shorter length.
export function periodLength(fmt: GameFormat, periodIndex: number): number {
  return periodIndex > fmt.numPeriods ? (fmt.otSeconds ?? fmt.periodSeconds) : fmt.periodSeconds;
}

// The display label for a period index (1-based). OT periods are numbered past
// the regulation count.
export function periodLabel(fmt: GameFormat, periodIndex: number): string {
  if (periodIndex > fmt.numPeriods) {
    const ot = periodIndex - fmt.numPeriods;
    return fmt.numPeriods === 1 || ot > 1 ? `OT${ot}` : 'OT';
  }
  return fmt.format === 'halves' ? `H${periodIndex}` : `Q${periodIndex}`;
}

// The weight bucket for a given period + remaining seconds: 1-4 for regulation,
// then one per overtime — 5 for OT, 6 for OT2, 7 for OT3. This is the integer
// sent to the backend as `quarter`, and every overtime weighs 1.5 there.
//
// All overtimes used to be 5, so a second overtime was filed on top of the
// first: its stats merged into OT's, and nothing could tell them apart.
export function weightBucket(fmt: GameFormat, periodIndex: number, remainingSeconds: number): number {
  if (periodIndex > fmt.numPeriods) return 4 + (periodIndex - fmt.numPeriods);
  if (fmt.format === 'quarters') {
    return Math.min(periodIndex, 4);
  }
  // halves: split each half into two equal time buckets
  const elapsed = fmt.periodSeconds - remainingSeconds;
  const secondHalf = elapsed >= fmt.periodSeconds / 2 ? 1 : 0;
  return (periodIndex - 1) * 2 + secondHalf + 1; // H1→1/2, H2→3/4
}

// Where the clock has to be for a stat to land in a given bucket — the inverse
// of weightBucket.
//
// The live tracker used to have two controls that looked like one: the period
// on the clock bar, and the Q1..Q4 row underneath it. Tapping Q3 moved only the
// second, so the header still said Q2, the clock still ran Q2, and the next
// time the clock crossed a boundary the tap was silently undone — stats went in
// under a quarter the coach thought they had left. The row sets the period now,
// and this is what it sets it to.
export function periodForBucket(fmt: GameFormat, bucket: number): { periodIndex: number; remaining: number } {
  if (bucket >= 5) return { periodIndex: fmt.numPeriods + (bucket - 4), remaining: fmt.otSeconds ?? fmt.periodSeconds };
  if (fmt.format === 'quarters') {
    return { periodIndex: Math.min(bucket, fmt.numPeriods), remaining: fmt.periodSeconds };
  }
  // Halves: each half is two buckets, so an odd bucket starts the half and an
  // even one starts at its midpoint.
  const periodIndex = Math.min(Math.floor((bucket - 1) / 2) + 1, fmt.numPeriods);
  const secondHalf = (bucket - 1) % 2 === 1;
  return { periodIndex, remaining: secondHalf ? fmt.periodSeconds / 2 : fmt.periodSeconds };
}

// The multiplier for a bucket (mirror of backend _quarter_multiplier).
export function bucketMultiplier(bucket: number): number {
  if (bucket <= 2) return 1.0;
  if (bucket === 3) return 1.25;
  return 1.5; // Q4 or OT
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
