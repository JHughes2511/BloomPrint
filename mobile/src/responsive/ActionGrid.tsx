/**
 * Lays a set of action buttons out two-per-row on web; leaves them alone on
 * native.
 *
 * On a phone a stack of full-width buttons is right — one thumb, one column.
 * In a browser that same stack is a tall ladder of wide buttons down the
 * middle of the page, and pairing them reads as one group of related actions
 * instead of a queue.
 *
 * Native renders the children exactly as passed, in order, with no wrapper
 * styling at all, so the phone layout is untouched.
 *
 * A child marked `full` spans the row — for the odd action that doesn't belong
 * to the pairs (an invite code next to four training actions, say).
 *
 * The grid is bounded and centred rather than spanning the whole content
 * column: at a 1100px report width each half was ~600px, which is a very large
 * target for a two-word label.
 */
import React from 'react';
import { View, Platform } from 'react-native';

type Props = {
  children: React.ReactNode;
  /** Gap between buttons, both axes. */
  gap?: number;
  /** Indices (0-based) that should span the full row rather than take a half. */
  full?: number[];
};

export default function ActionGrid({ children, gap = 12, full = [] }: Props) {
  const items = React.Children.toArray(children).filter(Boolean);

  if (Platform.OS !== 'web') return <>{children}</>;

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, width: '100%', maxWidth: 840, marginHorizontal: 'auto' }}>
      {items.map((child, i) => (
        <View
          key={i}
          style={
            full.includes(i)
              ? { width: '100%' }
              // Half the row minus its share of the gap. minWidth 0 lets a long
              // label shrink instead of forcing the pair to overflow.
              : { flexGrow: 1, flexBasis: `calc(50% - ${gap / 2}px)` as any, minWidth: 0 }
          }
        >
          {child}
        </View>
      ))}
    </View>
  );
}
