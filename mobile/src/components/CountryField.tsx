import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, FlatList, TextInput, SafeAreaView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { COUNTRIES } from '../data/countries';

/**
 * A reusable searchable country picker rendered as a tappable field.
 * <CountryField value={country} onChange={setCountry} />
 */
export default function CountryField({
  value,
  onChange,
  placeholder = 'Select country...',
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? COUNTRIES.filter(c => c.toLowerCase().includes(search.trim().toLowerCase()))
    : COUNTRIES;

  return (
    <>
      {!!label && <Text style={s.label}>{label}</Text>}
      <TouchableOpacity style={s.field} onPress={() => setOpen(true)}>
        <Text style={[s.fieldText, !value && { color: t.muted2 }]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={14} color={t.muted} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          style={s.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <SafeAreaView style={s.sheet}>
            <View style={s.header}>
              <Text style={s.title}>{tr('components.country.selectCountry')}</Text>
              <TouchableOpacity onPress={() => { setOpen(false); setSearch(''); }}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.search}
              placeholder={tr('components.country.searchCountries')}
              placeholderTextColor={t.muted2}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoFocus
            />
            <FlatList
              style={{ flex: 1 }}
              data={filtered}
              keyExtractor={item => item}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="none"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.option, value === item && s.optionActive]}
                  onPress={() => { onChange(item); setOpen(false); setSearch(''); }}
                >
                  <Text style={[s.optionText, value === item && { color: t.ink, fontFamily: fonts[700] }]}>
                    {item}
                  </Text>
                  {value === item && <Ionicons name="checkmark" size={16} color={t.accent} />}
                </TouchableOpacity>
              )}
            />
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  label: {
    alignSelf: 'flex-start', color: t.label, fontSize: 11,
    fontFamily: fonts[700], letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8,
  },
  field: {
    width: '100%', backgroundColor: t.card, borderRadius: 10, padding: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12, borderWidth: 1, borderColor: t.line,
  },
  fieldText: { color: t.ink, fontSize: 15, flex: 1 },
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    height: '75%', paddingBottom: 12, maxWidth: 560, marginHorizontal: 'auto'},
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
    paddingHorizontal: 20, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: t.divider,
  },
  optionActive: { backgroundColor: t.accentSoft },
  optionText: { color: t.inkSoft, fontSize: 15 },
});
