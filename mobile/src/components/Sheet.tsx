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
import { Modal, ModalProps, BackHandler, Platform, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { registerSheet } from '../web/sheetHistory';

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
      // One shared manager owns the history entries — see sheetHistory.ts for
      // why a sheet cannot safely push and pop its own.
      return registerSheet(() => closeRef.current?.());
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

/**
 * Close when the dark area outside the sheet is clicked.
 *
 * Every sheet in the app renders the same shape: one full-screen dimmed View
 * with the card inside it. That dim View is the backdrop, so a click landing on
 * IT — and not on any of its descendants — is a click outside the sheet.
 * Testing the event target is what makes that distinction; a plain press
 * handler on the backdrop would also fire for a click on the card, because the
 * press bubbles.
 *
 * Web only, and deliberately so: this reads the DOM. On a phone the back
 * gesture already closes a sheet (see useSheetBack), and there is no cursor to
 * click beside anything with.
 */
function useCloseOnBackdrop(visible: boolean, onClose?: () => void) {
  const hostRef = useRef<any>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (Platform.OS !== 'web' || !visible || !closeRef.current) return;
    const host = hostRef.current as any;
    const backdrop: HTMLElement | null = host?.firstElementChild ?? null;
    if (!backdrop?.addEventListener) return;
    const onClick = (e: any) => {
      if (e.target === backdrop) closeRef.current?.();
    };
    backdrop.addEventListener('click', onClick);
    return () => backdrop.removeEventListener('click', onClick);
    // `children` is not a dependency: the backdrop element is the same node for
    // the life of the sheet, and re-running on every render would rebind the
    // listener constantly.
  }, [visible]);

  return hostRef;
}

export default function Sheet({ visible, onRequestClose, children, ...rest }: ModalProps) {
  useSheetBack(!!visible, onRequestClose as (() => void) | undefined);
  const hostRef = useCloseOnBackdrop(!!visible, onRequestClose as (() => void) | undefined);
  return (
    <Modal visible={visible} onRequestClose={onRequestClose} {...rest}>
      <View ref={hostRef} style={{ flex: 1 }} collapsable={false}>
        {children}
      </View>
    </Modal>
  );
}
