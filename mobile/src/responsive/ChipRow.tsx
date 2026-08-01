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
import { View, ScrollView, StyleProp, ViewStyle, Platform } from 'react-native';
import { useBreakpoint } from './useBreakpoint';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Gap between chips when wrapped. Matches the scroller's spacing. */
  gap?: number;
  /**
   * Passed straight through to the native scroller. Required, not optional
   * polish: a horizontal ScrollView puts its padding and gap on the CONTENT
   * container, not on the view, so dropping it silently changes the phone
   * layout — which is exactly what happened when this component replaced a
   * scroller that had one.
   */
  contentContainerStyle?: StyleProp<ViewStyle>;
};

export default function ChipRow({ children, style, gap = 8, contentContainerStyle }: Props) {
  const { isDesktop } = useBreakpoint();

  // Platform AND width: a large tablet in landscape can satisfy the desktop
  // breakpoint, and wrapping there would be a native layout change. The phone
  // and tablet path has to stay the scroller it has always been.
  if (Platform.OS === 'web' && isDesktop) {
    return (
      <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap, alignItems: 'center' }, style]}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      contentContainerStyle={contentContainerStyle}
    >
      {children}
    </ScrollView>
  );
}
