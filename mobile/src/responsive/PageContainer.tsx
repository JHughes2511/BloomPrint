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
  const { gutter } = useBreakpoint();
  return (
    <View style={[{ flex: 1, width: '100%', alignItems: 'center' }, style]}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: maxWidth ?? CONTENT_MAX_WIDTH,
          paddingHorizontal: padded ? gutter : 0,
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
