/**
 * The content column every screen sits in.
 *
 * Two jobs: cap the width so content doesn't stretch across a large monitor,
 * and centre what's left. Without it each screen invents its own padding and
 * they stop lining up — the header of one screen sitting 16px from the edge
 * while the next starts at 32px is the kind of thing that reads as "unfinished"
 * without anyone being able to say why.
 *
 * On a phone it's a pass-through with the normal gutter, so nothing about the
 * native apps changes.
 */
import React from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import { useBreakpoint, CONTENT_MAX_WIDTH } from './useBreakpoint';

type Props = {
  children: React.ReactNode;
  /** Narrower cap for text-heavy screens — long lines are hard to read. */
  maxWidth?: number;
  /** Set false when a child (a FlatList, a full-bleed header) owns its padding. */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function PageContainer({ children, maxWidth, padded = true, style }: Props) {
  const { gutter, isPhone } = useBreakpoint();
  // No gutter on a phone. Every screen already carries its own horizontal
  // padding, tuned against a phone long before this wrapper existed, so adding
  // one here took 32px out of the content width on the exact device that has
  // the least to spare. The gutter exists to hold a centred column off the
  // edge of a wide window — a phone has no centred column and no spare edge.
  const pad = padded && !isPhone ? gutter : 0;
  return (
    <View style={[{ flex: 1, width: '100%', alignItems: 'center' }, style]}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: maxWidth ?? CONTENT_MAX_WIDTH,
          paddingHorizontal: pad,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * Reading width for long prose — reports, evaluations, training programs.
 *
 * Deliberately far narrower than the page cap. A 1280px line of text is
 * genuinely hard to read: the eye loses its place returning to the start of the
 * next line. Around 70-80 characters is the usual comfortable maximum, which is
 * what this works out to at the app's body size.
 */
export const READING_MAX_WIDTH = 760;

/**
 * Width for report and evaluation screens.
 *
 * Deliberately wider than READING_MAX_WIDTH, because these are not prose. A
 * BIM report is mostly short bullets, stat rows and flag cards — content that
 * is *shorter* than a line of text, not longer. Capping it at reading width
 * left a 760px ribbon down the middle of a 2000px display and made every
 * section three times taller than it needed to be, so a report that fits on
 * one screen became a long scroll.
 *
 * Genuine paragraphs inside these screens still get the narrower reading
 * measure applied locally, so nothing here produces 1100px lines of prose.
 */
export const REPORT_MAX_WIDTH = 1100;
