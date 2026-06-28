import React, { forwardRef, useRef, useEffect, useState, useImperativeHandle } from 'react';
import {
  ScrollView, ScrollViewProps, Keyboard, TextInput, Platform, StyleSheet,
  KeyboardEvent, NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';

/**
 * A ScrollView that scrolls the focused TextInput clear of the on-screen
 * keyboard on iOS, Android, and web.
 *
 * Implemented directly against current React Native APIs (no third-party
 * library — the popular one is unmaintained and silently no-ops on RN 0.81):
 *   1. On keyboard show we grab the focused input via
 *      `TextInput.State.currentlyFocusedInput()`, measure it in window
 *      coordinates, and if it overlaps the keyboard we scroll the difference.
 *   2. While the keyboard is open we add bottom padding equal to its height so
 *      there is always room to scroll the field up.
 *
 * The forwarded ref points at the underlying ScrollView, so existing
 * `ref.current.scrollTo()` / `scrollToEnd()` calls keep working.
 */
const EXTRA = 24; // breathing room above the keyboard

const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(
  ({ contentContainerStyle, onScroll, ...props }, ref) => {
    const scrollRef = useRef<ScrollView>(null);
    const scrollY = useRef(0);
    const [kbHeight, setKbHeight] = useState(0);

    useImperativeHandle(ref, () => scrollRef.current as ScrollView, []);

    useEffect(() => {
      const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

      const scrollToFocused = (kbScreenY: number) => {
        const State = TextInput.State as any;
        // Use the modern API when present; only fall back to the deprecated
        // currentlyFocusedField when currentlyFocusedInput doesn't exist (calling
        // the deprecated one logs a console warning every time).
        const input: any = typeof State.currentlyFocusedInput === 'function'
          ? State.currentlyFocusedInput()
          : State.currentlyFocusedField?.();
        if (!input || !scrollRef.current) return;
        const measure = input.measureInWindow?.bind(input);
        if (!measure) return;
        measure((_x: number, y: number, _w: number, h: number) => {
          const inputBottom = y + h;
          const limit = kbScreenY - EXTRA;
          if (inputBottom > limit) {
            scrollRef.current?.scrollTo({ y: scrollY.current + (inputBottom - limit), animated: true });
          }
        });
      };

      const showSub = Keyboard.addListener(showEvt, (e: KeyboardEvent) => {
        setKbHeight(e.endCoordinates.height);
        // Let the bottom padding apply first so there is room to scroll.
        setTimeout(() => scrollToFocused(e.endCoordinates.screenY), Platform.OS === 'ios' ? 10 : 60);
      });
      const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
      return () => { showSub.remove(); hideSub.remove(); };
    }, []);

    const handleScroll = (ev: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = ev.nativeEvent.contentOffset.y;
      onScroll?.(ev);
    };

    return (
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          contentContainerStyle,
          kbHeight ? { paddingBottom: kbHeight + EXTRA } : null,
        ]}
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
