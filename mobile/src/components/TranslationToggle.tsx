import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

/**
 * Sits above a report body to say whether it's being shown translated, and to
 * flip back to the language it was written in. Renders nothing when the report
 * is already in the reader's language.
 */
export default function TranslationToggle({
  canToggle, isTranslated, showOriginal, loading, onToggle,
}: {
  canToggle: boolean;
  isTranslated: boolean;
  showOriginal: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);

  if (loading) {
    return (
      <View style={s.row}>
        <ActivityIndicator size="small" color={t.accent} />
        <Text style={s.note} numberOfLines={1}>{tr('translation.translating')}</Text>
      </View>
    );
  }
  if (!canToggle) return null;

  return (
    <View style={s.row}>
      <Ionicons name="language-outline" size={13} color={t.muted} />
      <Text style={s.note} numberOfLines={1}>
        {isTranslated ? tr('translation.autoTranslated') : tr('translation.showingOriginal')}
      </Text>
      <TouchableOpacity onPress={onToggle} style={s.btn}>
        <Text style={s.btnText} numberOfLines={1}>
          {showOriginal ? tr('translation.showTranslation') : tr('translation.viewOriginal')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'nowrap' },
  note: { color: t.muted, fontSize: 11.5, flexShrink: 1 },
  btn: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 0 },
  btnText: { color: t.accent, fontSize: 11.5, fontFamily: fonts[700] },
});
