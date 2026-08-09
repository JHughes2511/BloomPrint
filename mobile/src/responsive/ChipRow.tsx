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
import { bleedRow, bleedContent } from './screenPadding';

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
  /**
   * The parent's horizontal padding, so the scroller can span the screen.
   *
   * Without it the row is inset by that padding, and a chip scrolled past the
   * start is cut 16 or 20px in from the glass with a stripe of background
   * beside it — which reads as a clipped layout rather than as more content.
   * The rows that already do this by hand (Recent's filters, Team Grade's
   * views) are the ones that look right; this is that arrangement as a prop.
   *
   * Ignored on the wrapping desktop path, where a negative margin would just
   * pull the chips outside the content column.
   */
  bleed?: number;
};

export default function ChipRow({ children, style, gap = 8, contentContainerStyle, bleed }: Props) {
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
      // flexShrink: 0 first, so a screen can still override it. react-native-web
      // gives every ScrollView `flexGrow: 1, flexShrink: 1`, which makes a chip
      // row a shrinkable item in the screen's column. When the content below is
      // long enough to over-fill that column, the row is what gives: it squeezes
      // under the pill's height, and a horizontal scroller clips what overflows
      // it, so the pill loses its top and bottom edge. It only showed up on the
      // filter that lists the most cards, which is why it read as a chip bug.
      style={[{ flexShrink: 0 }, style, bleed != null && bleedRow(bleed)]}
      // gap 0: these chips space themselves with marginRight, and adding the
      // wrap gap on top would double it.
      contentContainerStyle={[bleed != null && bleedContent(bleed, 0), contentContainerStyle]}
    >
      {children}
    </ScrollView>
  );
}
