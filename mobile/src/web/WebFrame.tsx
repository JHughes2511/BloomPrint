/**
 * Holds the app to phone proportions in a browser.
 *
 * Every screen here was laid out for a phone: full-width buttons, single-column
 * lists, a bottom tab bar. Stretched across a 1400px desktop window those stop
 * reading as an interface — a "Sign In" button a metre wide isn't a button any
 * more, and a form field that spans the screen has no visual relationship to
 * its label. Constraining the app to a phone-width column keeps every screen
 * looking like what it was designed as, and does it in one place rather than
 * by re-laying-out thirty screens.
 *
 * This is a v1 for web, not the end state. Screens that genuinely benefit from
 * width — the whiteboard, report reading, roster tables — are worth widening
 * individually later. Doing that first, for all of them, would have been weeks
 * before anything worked in a browser at all.
 *
 * On iOS and Android this renders its children untouched.
 */
import React from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';

// A shade wider than the largest phone, so nothing that fit on device gets
// tighter on the web.
const APP_MAX_WIDTH = 460;

export default function WebFrame({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return <Frame>{children}</Frame>;
}

function Frame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  // Below the cap there's nothing to centre — a phone browser should use the
  // whole screen, with no frame edges eating usable width.
  const narrow = width <= APP_MAX_WIDTH;

  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: '#0C2331' }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: APP_MAX_WIDTH,
          overflow: 'hidden',
          ...(narrow
            ? null
            : {
                // Enough edge definition to read as a device against the
                // backdrop, without dressing it up as a phone mockup.
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderColor: 'rgba(255,255,255,0.08)',
              }),
        }}
      >
        {children}
      </View>
    </View>
  );
}
