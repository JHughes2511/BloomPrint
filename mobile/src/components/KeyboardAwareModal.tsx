import React from 'react';
import { Modal, View, StyleSheet, StyleProp, ViewStyle, ScrollView } from 'react-native';
import Sheet from './Sheet';
import KeyboardAwareScrollView from './KeyboardAwareScrollView';

type Props = {
  visible: boolean;
  onRequestClose?: () => void;
  animationType?: 'none' | 'slide' | 'fade';
  /** 'bottom' = bottom sheet (default), 'center' = centered card. */
  position?: 'bottom' | 'center';
  /** Style for the dimmed full-screen overlay. */
  overlayStyle?: StyleProp<ViewStyle>;
  /** Style for the modal card/sheet itself. */
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * When true (default), children are placed inside a keyboard-aware ScrollView
   * so any focused input scrolls clear of the keyboard. Set false if the modal
   * manages its own scrolling (e.g. a FlatList) — it will still be keyboard-safe
   * via the overlay layout + Android resize.
   */
  scroll?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollRef?: React.Ref<ScrollView>;
  children: React.ReactNode;
};

/**
 * Standardized modal shell that keeps text inputs visible above the keyboard on
 * iOS, Android, and web. Drop-in replacement for the
 * `<Sheet><KeyboardAvoidingView><View>…</View></KeyboardAvoidingView></Sheet>`
 * pattern. Pass the screen's existing overlay/box styles via overlayStyle and
 * containerStyle to preserve the look; put ALL inner content (header, body,
 * footer) as children — do not nest another ScrollView when scroll is true.
 */
export default function KeyboardAwareModal({
  visible,
  onRequestClose,
  animationType = 'slide',
  position = 'bottom',
  overlayStyle,
  containerStyle,
  scroll = true,
  contentContainerStyle,
  scrollRef,
  children,
}: Props) {
  return (
    <Sheet visible={visible} transparent animationType={animationType} onRequestClose={onRequestClose}>
      <View style={[styles.overlay, position === 'center' ? styles.center : styles.bottom, overlayStyle]}>
        <View style={[styles.card, containerStyle]}>
          {scroll ? (
            <KeyboardAwareScrollView contentContainerStyle={contentContainerStyle} ref={scrollRef}>
              {children}
            </KeyboardAwareScrollView>
          ) : (
            children
          )}
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)' },
  bottom: { justifyContent: 'flex-end' },
  center: { justifyContent: 'center', paddingHorizontal: 16 },
  card: { backgroundColor: '#111827', borderRadius: 20, padding: 20, maxHeight: '90%', margin: 8 },
});
