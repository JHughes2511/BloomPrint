/**
 * A Modal that the back gesture closes.
 *
 * Every sheet in this app is a react-native Modal, and a Modal is invisible to
 * navigation: with one open, a swipe back on iOS popped the whole screen and
 * took the half-filled form with it, and in a browser the back button left the
 * page entirely. What people expect from a phone is that back closes what is on
 * top — the sheet — and only then leaves the screen.
 *
 * Same props as Modal. `onRequestClose` is what makes it work: a sheet without
 * one has no way to be closed on request, so it behaves exactly as before.
 */
import React, { useEffect, useRef } from 'react';
import { Modal, ModalProps, BackHandler, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export function useSheetBack(visible: boolean, onClose?: () => void) {
  // Read through a ref so the effect depends on `visible` alone. An inline
  // arrow as the handler would otherwise re-register every render, and on web
  // that means pushing a second history entry for the same sheet.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const navigation = useNavigation<any>();

  useEffect(() => {
    if (!visible || !closeRef.current) return;

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      // An entry of our own, so back has something to consume that isn't the
      // page. The state marks it as ours; nothing reads it back, but it makes
      // the entry legible in devtools.
      window.history.pushState({ bloomprintSheet: true }, '');
      let closedByBack = false;
      const onPop = () => { closedByBack = true; closeRef.current?.(); };
      window.addEventListener('popstate', onPop);
      return () => {
        window.removeEventListener('popstate', onPop);
        // Closed from the UI instead — an X, a Cancel, a successful save. The
        // entry we pushed is still there and would swallow the next back
        // press, so spend it now. The listener is already gone, so this
        // cannot re-enter.
        if (!closedByBack) window.history.back();
      };
    }

    // Android's hardware/gesture back.
    const hardware = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current?.();
      return true;   // handled — do not pop the screen
    });
    // iOS has no back button; its edge swipe removes the screen, which this
    // turns into "close the sheet" for as long as one is open.
    const unsubscribe = navigation?.addListener?.('beforeRemove', (e: any) => {
      e.preventDefault();
      closeRef.current?.();
    });

    return () => {
      hardware.remove();
      unsubscribe?.();
    };
  }, [visible, navigation]);
}

export default function Sheet({ visible, onRequestClose, children, ...rest }: ModalProps) {
  useSheetBack(!!visible, onRequestClose as (() => void) | undefined);
  return (
    <Modal visible={visible} onRequestClose={onRequestClose} {...rest}>
      {children}
    </Modal>
  );
}
