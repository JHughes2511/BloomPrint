/**
 * Where a mark sits on the floor, independent of how the board is being shown.
 *
 * Marks are stored as pixels, so every change of court view (Full / Half / ¾)
 * or orientation converts them. That conversion is only correct if it starts
 * from the scale the pixels were ACTUALLY baked at — and the board records
 * that, in `canvas`.
 *
 * It used to re-derive the starting scale from the layout instead, which is a
 * different number the moment the layout has not caught up: switching
 * orientation changes which way the court is fitted, and the measured area
 * arrives a frame later. Each switch then converted by a slightly wrong ratio,
 * and because the result was stored, five quick switches multiplied five
 * errors together and put the drawing off the floor.
 *
 * Anchoring to the recorded bake makes each conversion self-correcting rather
 * than compounding: if a switch lands while the layout is stale, the NEXT
 * render sees the stamp disagree with the real scale and fixes it by one exact
 * ratio, instead of building on the mistake.
 */
export const COURT_FT_W = 50;
export const COURT_FT_L = 94;
export const VISIBLE_FT: Record<string, number> = { full: 94, three_quarter: 78, half: 47 };
export const OOB_SIDE_FT = 3;
export const OOB_BASE_FT = 4;
export const PADDED_FT_W = COURT_FT_W + OOB_SIDE_FT * 2;

export const topPadFt = (visFt: number) => (COURT_FT_L - visFt === 0 ? OOB_BASE_FT : 0);
export const vTotalFt = (visFt: number) => visFt + topPadFt(visFt) + OOB_BASE_FT;

export type CourtType = 'full' | 'half' | 'three_quarter';

/** Pixels per foot for a view, given the area it must fit into. */
export function pxPerFoot(fitW: number, fitH: number, type: CourtType): number {
  const vis = VISIBLE_FT[type] ?? VISIBLE_FT.full;
  const raw = fitW > 20 && fitH > 20
    ? Math.min((fitW - 20) / PADDED_FT_W, (fitH - 20) / vTotalFt(vis))
    : 0;
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** How far down the court a view starts, in feet. */
export function offsetFtForType(type: CourtType): number {
  const visFt = VISIBLE_FT[type] ?? VISIBLE_FT.full;
  return (COURT_FT_L - visFt) - topPadFt(visFt);
}

/**
 * The scale a board's stored pixels are baked at, from its recorded canvas.
 *
 * Zero when the board has never been stamped — an old board, or one whose marks
 * arrived before the first layout. Callers must treat zero as "unknown" and
 * leave the marks alone rather than converting by a guess.
 */
export function bakedScale(canvas?: { w?: number } | null): number {
  const w = canvas?.w ?? 0;
  return w > 0 ? w / PADDED_FT_W : 0;
}

/** The canvas stamp for a view at a given scale — what to record after baking. */
export function canvasStamp(type: CourtType, scale: number) {
  return { w: PADDED_FT_W * scale, h: vTotalFt(VISIBLE_FT[type] ?? VISIBLE_FT.full) * scale, type };
}

type Convert = { x: (px?: number) => number | undefined; y: (px?: number) => number | undefined;
                 size: (v?: number) => number | undefined; path: (d?: string) => string | undefined };

/**
 * Converting a pixel coordinate from one (scale, view) to another.
 *
 * Both scales are given rather than derived, because the whole point is that
 * the source scale is a recorded fact and not something to recompute.
 */
export function converter(fromScale: number, fromType: CourtType,
                          toScale: number, toType: CourtType): Convert | null {
  if (!fromScale || !toScale) return null;
  const offA = offsetFtForType(fromType);
  const offB = offsetFtForType(toType);
  const x = (px?: number) => px == null ? px : (px / fromScale) * toScale;
  const y = (px?: number) => px == null ? px : ((px / fromScale + offA) - offB) * toScale;
  const size = (v?: number) => v == null ? v : v * (toScale / fromScale);
  const path = (d?: string) => !d ? d : d.replace(/([-\d.]+)\s+([-\d.]+)/g,
    (_m, a, b) => `${x(parseFloat(a))!.toFixed(2)} ${y(parseFloat(b))!.toFixed(2)}`);
  return { x, y, size, path };
}

/** Apply a conversion to one stroke-shaped object. */
export function convertStroke<T extends Record<string, any>>(s: T, c: Convert): T {
  return {
    ...s,
    d: c.path(s.d),
    cx: c.x(s.cx), cy: c.y(s.cy), r: c.size(s.r), size: c.size(s.size),
    x1: c.x(s.x1), y1: c.y(s.y1), x2: c.x(s.x2), y2: c.y(s.y2),
    x: c.x(s.x), y: c.y(s.y),
  };
}
