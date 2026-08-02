/**
 * Full-screen QR scanner — browser implementation.
 *
 * expo-camera's own web scanner does not work here, and could not: it starts a
 * Worker whose first statement is
 *
 *     importScripts('https://cdn.jsdelivr.net/npm/jsqr@1.2.0/dist/jsQR.min.js')
 *
 * so scanning depends on a third-party CDN being reachable at the moment a
 * player points their phone at a coach's screen. In this app it simply fails —
 * the worker throws "failed to load", no code is ever decoded, and the button
 * looks broken. Bundling the decoder instead means the scanner ships with the
 * app and works the same offline, behind a school firewall, or in a browser
 * that blocks cross-origin scripts.
 *
 * The decode itself prefers the browser's built-in BarcodeDetector, which is
 * hardware-accelerated where it exists, and falls back to jsQR — which covers
 * Safari, and Safari on iOS is where most players will be standing.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import jsQR from 'jsqr';
import { fonts } from '../theme/typography';

export type QrScannerProps = {
  visible: boolean;
  onScan: (value: string) => void;
  onClose: () => void;
};

/** Decoding every frame is wasted work; a QR sits in view for far longer. */
const SCAN_INTERVAL_MS = 120;
/** jsQR cost is per pixel, and a QR is legible long before full resolution. */
const MAX_EDGE = 640;

export default function QrScanner({ visible, onScan, onClose }: QrScannerProps) {
  const { t: tr } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so the camera is started by `visible` alone. As an effect
  // dependency, a caller's inline arrow would tear down and re-acquire the
  // MediaStream on every render — the preview would flicker and Safari would
  // re-prompt.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!visible) { stop(); return; }

    doneRef.current = false;
    setError(null);

    let cancelled = false;
    let timer: any = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Chrome and Chrome-for-Android have this; Safari does not. Constructing it
    // is not enough — a browser may expose the class without QR support.
    let detector: any = null;
    const makeDetector = async () => {
      const Ctor = (window as any).BarcodeDetector;
      if (!Ctor) return null;
      try {
        const formats: string[] = await Ctor.getSupportedFormats();
        if (!formats.includes('qr_code')) return null;
        return new Ctor({ formats: ['qr_code'] });
      } catch { return null; }
    };

    const found = (raw: string | null | undefined) => {
      const value = (raw || '').trim();
      if (!value || doneRef.current || cancelled) return;
      doneRef.current = true;
      stop();
      onScanRef.current(value);
    };

    const tick = async () => {
      const video = videoRef.current;
      if (cancelled || doneRef.current || !video || video.readyState < 2) return;

      if (detector) {
        try {
          const hits = await detector.detect(video);
          if (hits?.length) return found(hits[0].rawValue);
        } catch {
          // A detector that throws mid-session (some Android builds do when the
          // track is briefly interrupted) should not kill scanning outright.
          detector = null;
        }
      }

      if (!ctx) return;
      const { videoWidth: w, videoHeight: h } = video;
      if (!w || !h) return;
      const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hit = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
      if (hit) found(hit.data);
    };

    const start = async () => {
      // getUserMedia is unavailable on plain http, which is worth saying out
      // loud: otherwise a developer hitting the LAN address sees "no camera".
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(window.isSecureContext === false
          ? tr('playerApp.link.cameraInsecure')
          : tr('playerApp.link.cameraUnsupported'));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // iOS Safari refuses to play inline without both of these and will
          // otherwise take the video full-screen over the whole page.
          video.setAttribute('playsinline', 'true');
          video.muted = true;
          await video.play().catch(() => {});
        }
        detector = await makeDetector();
        timer = setInterval(tick, SCAN_INTERVAL_MS);
      } catch (e: any) {
        setError(e?.name === 'NotAllowedError'
          ? tr('playerApp.link.cameraMsg')
          : tr('playerApp.link.cameraUnavailable'));
      }
    };

    start();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stop();
    };
  }, [visible, stop, tr]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={styles.root}>
        {/* A DOM <video> rather than a react-native <Image>: this is a live
            MediaStream, which only a video element can render. */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />

        <View style={styles.overlay} pointerEvents="box-none">
          {!error && <View style={styles.frame} />}
          <Text style={styles.hint} numberOfLines={4}>
            {error ?? tr('playerApp.link.pointAtQr')}
          </Text>
        </View>

        <TouchableOpacity style={styles.close} onPress={onClose} accessibilityLabel={tr('common.cancel')}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 230, height: 230, borderRadius: 24, borderWidth: 3, borderColor: '#fff' },
  hint: { color: '#fff', fontSize: 14, fontFamily: fonts[700], marginTop: 20, textAlign: 'center', paddingHorizontal: 32 },
  close: {
    position: 'absolute', top: 24, right: 24, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
});
