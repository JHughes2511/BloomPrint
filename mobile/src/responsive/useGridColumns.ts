/**
 * Column count and card width for a card grid.
 *
 * Takes the number of columns the screen WANTS, not a card width to aim at.
 * Deriving the count from a target width was too easy to get wrong: the same
 * target lands on a different count depending on the page cap, the sidebar and
 * the window, so a screen that showed three columns on one display showed two
 * on another. Asking for three and stepping down only when there genuinely
 * isn't room is predictable, and it is what a person actually means when they
 * say "three across".
 *
 * Width is then an exact division of the measured row after the gutters are
 * removed, so every card is the same size — including the last row, which with
 * a percentage or a flex basis ends up wider than a full row's cards.
 *
 * Web only. On native this always reports one column and no width, which is
 * what every one of these screens has always rendered on a phone.
 */
import { useCallback, useState, useEffect, useRef } from 'react';
import { LayoutChangeEvent, Platform } from 'react-native';

type Options = {
  /** Columns to use when there is room. */
  columns: number;
  /** Never make a card narrower than this; drop a column instead. */
  min?: number;
  gap?: number;
  /**
   * Total horizontal padding on the grid, both sides combined.
   *
   * Subtracted before the division because onLayout reports the padded box:
   * without this the cards are sized for a row wider than the one they sit in
   * and the last column overhangs the right edge — which is the asymmetry
   * where cards have space on the left and none on the right.
   */
  inset?: number;
};

export function useGridColumns({ columns: want, min = 260, gap = 12, inset = 0 }: Options) {
  const [width, setWidth] = useState(0);
  const node = useRef<any>(null);

  const measure = useCallback(() => {
    const n: any = node.current;
    const w = n?.getBoundingClientRect?.().width ?? n?.offsetWidth ?? 0;
    if (w > 0) setWidth(prev => (Math.abs(prev - w) > 1 ? w : prev));
  }, []);

  // A callback ref rather than a plain one: this hook lives in the screen, and
  // the row it measures mounts later — on a fresh load into a view, long after
  // the screen itself. Measuring at mount found nothing to measure, which is
  // why a refresh left every card the size of its own text.
  const ref = useCallback((n: any) => {
    node.current = n;
    if (n) {
      measure();
      requestAnimationFrame(measure);
    }
  }, [measure]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setWidth(prev => (Math.abs(prev - w) > 1 ? w : prev));
  }, []);

  // onLayout is not enough on its own. Measured rather than assumed: a page
  // loaded straight into a view — a refresh, or a link — mounts this row
  // without ever delivering a layout, so the width stayed 0, the columns
  // collapsed to one and every card fell back to the size of its own text.
  // A window resize did not rescue it either. Reading the node settles it.
  // And whenever the window changes, since the row's share of it changes too.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const isWeb = Platform.OS === 'web';

  const usable = Math.max(0, width - inset);

  // How many of `want` actually fit at the minimum card size.
  const fits = usable > 0 ? Math.floor((usable + gap) / (min + gap)) : 1;
  const columns = !isWeb || usable === 0 ? 1 : Math.max(1, Math.min(want, fits));

  const cardWidth =
    !isWeb || usable === 0 || columns === 1
      ? undefined
      : Math.floor((usable - gap * (columns - 1)) / columns);

  return { ref, onLayout, columns, cardWidth, gap };
}
