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
import { useCallback, useState } from 'react';
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

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth(prev => (Math.abs(prev - w) > 1 ? w : prev));
  }, []);

  const isWeb = Platform.OS === 'web';

  const usable = Math.max(0, width - inset);

  // How many of `want` actually fit at the minimum card size.
  const fits = usable > 0 ? Math.floor((usable + gap) / (min + gap)) : 1;
  const columns = !isWeb || usable === 0 ? 1 : Math.max(1, Math.min(want, fits));

  const cardWidth =
    !isWeb || usable === 0 || columns === 1
      ? undefined
      : Math.floor((usable - gap * (columns - 1)) / columns);

  return { onLayout, columns, cardWidth, gap };
}
