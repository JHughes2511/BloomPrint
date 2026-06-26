import React, { forwardRef } from 'react';
import { ScrollView, ScrollViewProps, Platform, StyleSheet } from 'react-native';

/**
 * A ScrollView preconfigured so a focused TextInput is never hidden behind the
 * on-screen keyboard, on iOS, Android, and web.
 *
 * - iOS: `automaticallyAdjustKeyboardInsets` auto-insets the scroll content by
 *   the keyboard height so the focused field scrolls into view — no fragile
 *   manual scrollTo() math, no offset guessing.
 * - Android: handled by `softwareKeyboardLayoutMode: "resize"` (app.json) which
 *   shrinks the window above the keyboard; the scroll content fits naturally.
 * - Web: the browser scrolls the focused input into view natively.
 *
 * `keyboardShouldPersistTaps="handled"` keeps taps on buttons/results working
 * while the keyboard is open; `keyboardDismissMode` lets a drag dismiss it.
 */
const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(
  ({ contentContainerStyle, ...props }, ref) => {
    return (
      <ScrollView
        ref={ref}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        {...props}
      >
        {props.children}
      </ScrollView>
    );
  },
);

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
});

export default KeyboardAwareScrollView;
