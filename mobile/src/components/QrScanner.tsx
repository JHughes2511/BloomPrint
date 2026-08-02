/**
 * Full-screen QR scanner.
 *
 * A coach shows the invite QR from their player's profile and the player scans
 * it to link — so this has to work wherever the player happens to be, which in
 * practice is a phone browser as often as the installed app. The web build gets
 * its own implementation in QrScanner.web.tsx; this is the native one, where
 * expo-camera hands us decoded barcodes directly.
 *
 * Permission lives here rather than at the call site so both platforms ask for
 * the camera the same way and the caller only has to say "show the scanner".
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { fonts } from '../theme/typography';

export type QrScannerProps = {
  visible: boolean;
  onScan: (value: string) => void;
  onClose: () => void;
};

export default function QrScanner({ visible, onScan, onClose }: QrScannerProps) {
  const { t: tr } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  // One code per opening. onBarcodeScanned fires every frame the code is in
  // view, so without this the same invite is submitted a dozen times.
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!visible) { setDone(false); return; }
    if (!permission?.granted) requestPermission();
  }, [visible, permission?.granted]);

  const handle = ({ data }: { data: string }) => {
    if (done) return;
    const value = (data || '').trim();
    if (!value) return;
    setDone(true);
    onScan(value);
  };

  const denied = permission != null && !permission.granted && !permission.canAskAgain;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handle}
          />
        ) : null}

        <View style={styles.overlay} pointerEvents="box-none">
          <View style={styles.frame} />
          <Text style={styles.hint} numberOfLines={3}>
            {denied ? tr('playerApp.link.cameraMsg') : tr('playerApp.link.pointAtQr')}
          </Text>
        </View>

        <TouchableOpacity style={styles.close} onPress={onClose} accessibilityLabel={tr('common.cancel')}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

export const scannerStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 230, height: 230, borderRadius: 24, borderWidth: 3, borderColor: '#fff' },
  hint: { color: '#fff', fontSize: 14, fontFamily: fonts[700], marginTop: 20, textAlign: 'center', paddingHorizontal: 32 },
  close: {
    position: 'absolute', top: 56, right: 24, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
});

const styles = scannerStyles;
