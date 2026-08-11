/**
 * What BloomPrint has learned from this coach's corrections.
 *
 * Every correction is the coach saying what a report should have been paying
 * attention to, and each one becomes a standing instruction on what comes
 * next. That is only reasonable if they can see the list: an instruction
 * working invisibly is a report drifting for reasons nobody can point at, and
 * a team in March is not the team it was in November.
 *
 * Two places, one component — the team's own page, filtered to that team, and
 * the profile, where the whole list lives. Nothing about them differs except
 * which rows are in it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { preferencesAPI, CoachPreference } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

type Props = {
  /** Show only what applies to this team, plus the program-wide ones. */
  teamId?: number | null;
  /** Shown above the list; omitted where the screen already has a heading. */
  title?: string;
};

export default function LearnedPreferences({ teamId, title }: Props) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const [rows, setRows] = useState<CoachPreference[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(await preferencesAPI.list(teamId ?? undefined));
    } catch {
      /* an empty list is the honest fallback: nothing has been learned that
         we can show, and an error here must not take the sheet down */
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { void load(); }, [load]);

  // Both changes are applied on screen first. Deleting a line the coach has
  // just read should not take a round trip to look like it happened.
  const toggle = async (row: CoachPreference) => {
    const next = !row.active;
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, active: next } : r)));
    try { await preferencesAPI.setActive(row.id, next); }
    catch { setRows(prev => prev.map(r => (r.id === row.id ? { ...r, active: row.active } : r))); }
  };

  const remove = async (row: CoachPreference) => {
    const before = rows;
    setRows(prev => prev.filter(r => r.id !== row.id));
    try { await preferencesAPI.remove(row.id); }
    catch { setRows(before); }
  };

  if (loading) {
    return <ActivityIndicator color={t.accent} style={{ marginVertical: 16 }} />;
  }

  return (
    <View style={{ marginTop: 8 }}>
      {!!title && <Text style={s.label}>{title}</Text>}
      {rows.length === 0 ? (
        <Text style={s.empty}>{tr('preferences.empty')}</Text>
      ) : (
        <>
          <Text style={s.hint}>{tr('preferences.hint')}</Text>
          {rows.map(row => (
            <View key={row.id} style={s.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.text, !row.active && s.textOff]}>{row.text}</Text>
                <Text style={s.scope}>
                  {row.team_name
                    ? tr('preferences.forTeam', { name: row.team_name })
                    : tr('preferences.everyTeam')}
                </Text>
              </View>
              {/* Off keeps the record and stops it being applied; the bin is
                  for one the coach no longer wants at all. */}
              <Switch
                value={row.active}
                onValueChange={() => toggle(row)}
                trackColor={{ false: t.line, true: t.accent }}
                thumbColor="#fff"
              />
              <TouchableOpacity onPress={() => remove(row)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={16} color={t.muted2} />
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  label: { color: t.label, fontSize: 11, fontFamily: fonts[700], textTransform: 'uppercase',
           letterSpacing: 1, marginBottom: 6 },
  hint: { color: t.muted2, fontSize: 11.5, marginBottom: 10, lineHeight: 16 },
  empty: { color: t.muted2, fontSize: 12.5, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
         borderBottomWidth: 1, borderBottomColor: t.divider },
  text: { color: t.ink, fontSize: 13, lineHeight: 18 },
  textOff: { color: t.muted2, textDecorationLine: 'line-through' },
  scope: { color: t.muted2, fontSize: 11, marginTop: 2 },
});
