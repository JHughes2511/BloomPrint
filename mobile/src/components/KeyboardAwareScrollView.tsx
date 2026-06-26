import React, { forwardRef } from 'react';
import { ScrollView, ScrollViewProps, Platform, StyleSheet } from 'react-native';
import { KeyboardAwareScrollView as KASV } from 'react-native-keyboard-aware-scroll-view';

/**
 * A ScrollView that reliably scrolls a focused TextInput clear of the on-screen
 * keyboard on iOS, Android, and web.
 *
 * Backed by react-native-keyboard-aware-scroll-view (pure JS, Expo Go safe),
 * which measures the focused input and scrolls it into view — handling the
 * cases the built-in `automaticallyAdjustKeyboardInsets` misses (multiline
 * inputs at the bottom of a form, inputs inside modals, etc.).
 *
 * The forwarded ref points at the underlying ScrollView, so existing
 * `ref.current.scrollTo()` / `scrollToEnd()` calls keep working.
 */
const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(
  ({ contentContainerStyle, ...props }, ref) => {
    return (
      <KASV
        // forward the real ScrollView node to the caller's ref
        innerRef={(node: any) => {
          if (typeof ref === 'function') ref(node);
          else if (ref) (ref as React.MutableRefObject<any>).current = node;
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        enableOnAndroid
        enableResetScrollToCoords={false}
        extraScrollHeight={Platform.OS === 'ios' ? 24 : 100}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        {...(props as any)}
      >
        {props.children}
      </KASV>
    );
  },
);

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
});

export default KeyboardAwareScrollView;
