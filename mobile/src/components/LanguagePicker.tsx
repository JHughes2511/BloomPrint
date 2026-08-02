import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, FlatList, SafeAreaView, TextInput } from 'react-native';
import Sheet from './Sheet';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, languageName } from '../i18n/languages';
import { setAppLanguage, currentLanguage } from '../i18n';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { sheetCap } from '../responsive/modalSizes';

/**
 * App-language selector. Renders as a tappable row (globe + current language)
 * that opens a searchable sheet of every shipped pack. Switching applies
 * instantly app-wide and persists; `onChanged` lets callers also sync the
 * choice to the account profile.
 */
export default function LanguagePicker({ compact, onChanged }: {
  compact?: boolean;                       // smaller row for headers/signup
  onChanged?: (code: string) => void;      // e.g. save to coach profile
}) {
  const { t } = useTranslation();
  const { t: theme } = useTheme();
  const s = makeStyles(theme);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = currentLanguage();

  const filtered = search.trim()
    ? LANGUAGES.filter(l =>
        l.native.toLowerCase().includes(search.toLowerCase()) ||
        l.english.toLowerCase().includes(search.toLowerCase()))
    : LANGUAGES;

  const pick = async (code: string) => {
    await setAppLanguage(code);
    setOpen(false);
    setSearch('');
    onChanged?.(code);
  };

  return (
    <>
      <TouchableOpacity style={[s.row, compact && s.rowCompact]} onPress={() => setOpen(true)}>
        <Ionicons name="globe-outline" size={compact ? 14 : 16} color={theme.muted} />
        <Text style={[s.rowText, compact && { fontSize: 12 }]}>{languageName(current)}</Text>
        <Ionicons name="chevron-down" size={compact ? 12 : 14} color={theme.muted2} />
      </TouchableOpacity>

      <Sheet visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={s.overlay}>
          <SafeAreaView style={s.sheet}>
            <View style={s.header}>
              <Text style={s.title}>{t('common.language')}</Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Ionicons name="close" size={22} color={theme.muted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.search}
              placeholder={t('common.search')}
              placeholderTextColor={theme.muted2}
              value={search}
              onChangeText={setSearch}
            />
            <FlatList
              data={filtered}
              keyExtractor={item => item.code}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.option, current === item.code && s.optionActive]}
                  onPress={() => pick(item.code)}
                >
                  <View>
                    <Text style={[s.optionText, current === item.code && { color: theme.ink, fontFamily: fonts[700] }]}>
                      {item.native}
                    </Text>
                    {item.english !== item.native && <Text style={s.optionSub}>{item.english}</Text>}
                  </View>
                  {current === item.code && <Ionicons name="checkmark" size={16} color={theme.accent} />}
                </TouchableOpacity>
              )}
            />
          </SafeAreaView>
        </View>
      </Sheet>
    </>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: t.line, borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'center',
  },
  rowCompact: { paddingHorizontal: 10, paddingVertical: 6 },
  rowText: { color: t.muted, fontSize: 13, fontFamily: fonts[600] },
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '80%', paddingBottom: 20, ...sheetCap(560)},
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: t.divider,
  },
  title: { color: t.ink, fontSize: 18, fontFamily: fonts[800] },
  search: {
    backgroundColor: t.chip, borderRadius: 10, margin: 16, padding: 12,
    color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line,
  },
  option: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 13,
    borderTopWidth: 1, borderTopColor: t.divider,
  },
  optionActive: { backgroundColor: t.accentSoft },
  optionText: { color: t.inkSoft, fontSize: 15 },
  optionSub: { color: t.muted2, fontSize: 11.5, marginTop: 1 },
});
