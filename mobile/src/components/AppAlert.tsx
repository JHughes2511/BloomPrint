/**
 * The app's own alert, for the web build.
 *
 * react-native-web has no Alert, so every confirmation went through
 * window.confirm — which a browser is required to label with the site's own
 * name. "bloomprint.org says" above "Remove Brady Smith from the roster?" reads
 * like a warning about the site rather than a question from it, and none of it
 * can be styled or removed while the browser owns the dialog.
 *
 * Drawing it ourselves also fixes what window.confirm could never express: it
 * offers exactly two answers, so a three-button Alert lost one silently — which
 * is how Rename disappeared from the roster's team menu.
 *
 * Native is untouched: iOS and Android already have a real Alert, and this
 * host renders nothing there.
 */
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { sheetCap } from '../responsive/modalSizes';
import { subscribeToAlerts, resolveAlert, AlertRequest, AlertButton } from '../web/alertQueue';

export default function AppAlert() {
  const { t } = useTheme();
  const styles = makeStyles(t);
  const [current, setCurrent] = useState<AlertRequest | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    subscribeToAlerts(setCurrent);
    return () => subscribeToAlerts(null);
  }, []);

  if (Platform.OS !== 'web' || !current) return null;

  const choose = (button?: AlertButton) => {
    resolveAlert(current.id);
    button?.onPress?.();
  };

  // Dismissing without choosing means cancel where there is one, and nothing
  // where there isn't — never the destructive button.
  const cancel = current.buttons.find(b => b.style === 'cancel');
  const dismiss = () => choose(current.buttons.length === 1 ? current.buttons[0] : cancel);

  // Two answers sit side by side; three or more stack, because three short
  // buttons in a row are a guessing game about which is which.
  const stacked = current.buttons.length > 2;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <Pressable style={styles.backdrop} onPress={dismiss}>
        {/* Stops a press inside the card from counting as a dismissal. */}
        <Pressable style={styles.card} onPress={() => {}}>
          {!!current.title && <Text style={styles.title}>{current.title}</Text>}
          {!!current.message && <Text style={styles.message}>{current.message}</Text>}

          <View style={[styles.row, stacked && styles.stack]}>
            {current.buttons.map((b, i) => {
              const tone =
                b.style === 'destructive' ? t.negative
                : b.style === 'cancel' ? t.muted
                : t.accent;
              return (
                <Pressable
                  key={`${b.text ?? i}-${i}`}
                  onPress={() => choose(b)}
                  style={({ hovered }: any) => [
                    styles.button,
                    stacked ? styles.buttonStacked : styles.buttonInline,
                    hovered && styles.buttonHover,
                  ]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.buttonText, { color: tone }]} numberOfLines={1}>
                    {b.text ?? 'OK'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: t.scrim,
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    backgroundColor: t.sheet, borderRadius: 16, padding: 22,
    borderWidth: 1, borderColor: t.cardBorder,
    ...sheetCap(420),
  },
  title: { color: t.ink, fontSize: 17, fontFamily: fonts[800], marginBottom: 6 },
  message: { color: t.inkSoft, fontSize: 14.5, lineHeight: 21 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 20 },
  stack: { flexDirection: 'column', alignItems: 'stretch' },
  button: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 16 },
  buttonInline: { minWidth: 92, alignItems: 'center' },
  buttonStacked: { alignItems: 'center' },
  buttonHover: { backgroundColor: t.chip },
  buttonText: { fontSize: 14.5, fontFamily: fonts[700] },
});
