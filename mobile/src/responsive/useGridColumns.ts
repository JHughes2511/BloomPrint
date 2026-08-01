/**
 * Column count and card width for a card grid, solved together from the space
 * the grid actually has.
 *
 * The two have to be solved together. Fitting the count first and then sizing
 * cards with a percentage does not work: N columns at 100/N% plus (N-1) gaps is
 * wider than the row, so the last card runs off the edge. Subtracting the
 * gutters before dividing gives cards that are exactly equal and always fit —
 * including a short final row, which otherwise ends up a different width from a
 * full one.
 *
 * Driven by the measured width rather than the window, because the sidebar
 * takes a fixed slice out of the window and every screen sits in a capped,
 * centred column. The grid is the only thing that knows what it actually got.
 *
 * `target` is the width a card wants; the grid fits as many as it can at or
 * above that. Screens pass different targets so a dense list and a roomy one
 * can land on different counts at the same window size.
 *
 * Web only. On native this always reports a single column, which is what every
 * one of these screens has always rendered on a phone.
 */
import { useCallback, useState } from 'react';
import { LayoutChangeEvent, Platform } from 'react-native';

export function useGridColumns(target: number, gap = 12, pad = 8) {
  const [width, setWidth] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth(prev => (Math.abs(prev - w) > 1 ? w : prev));
  }, []);

  const usable = Math.max(0, width - pad);
  const columns =
    Platform.OS !== 'web' || usable === 0
      ? 1
      : Math.max(1, Math.min(6, Math.floor((usable + gap) / (target + gap))));

  const cardWidth =
    Platform.OS !== 'web' || usable === 0 || columns === 1
      ? undefined
      : Math.floor((usable - gap * (columns - 1)) / columns);

  return { onLayout, columns, cardWidth, gap };
}
