/**
 * A row of chips that wraps when there's room and scrolls when there isn't.
 *
 * On a phone a horizontal scroller is right: the chips can't all fit, and
 * swiping is the natural way through them. On a desktop it's the wrong
 * behaviour — the row clips mid-word at the edge of the content column
 * ("Box Score  Team Training  Ga…") and hides the remaining options behind a
 * gesture nobody expects on a mouse, on a screen with plenty of space to show
 * them all.
 *
 * Same children either way, so the chips themselves don't change.
 */
import React from 'react';
import { View, ScrollView, StyleProp, ViewStyle } from 'react-native';
import { useBreakpoint } from './useBreakpoint';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Gap between chips when wrapped. Matches the scroller's spacing. */
  gap?: number;
};

export default function ChipRow({ children, style, gap = 8 }: Props) {
  const { isDesktop } = useBreakpoint();

  if (isDesktop) {
    return (
      <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap, alignItems: 'center' }, style]}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style}>
      {children}
    </ScrollView>
  );
}
