/**
 * Import a team's injury report — a photo, screenshot, PDF or spreadsheet —
 * into the injury log. The report is read into rows the coach checks before
 * anything is saved: who (and whether they are on the roster), status, what,
 * and the dates the report printed. Untick a row to leave it out.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Sheet from './Sheet';
import { injuriesAPI } from '../api/client';
import { INJURY_STATUSES, statusColor } from './InjuryLog';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { sheetCap } from '../responsive/modalSizes';

interface Props {
  file: { uri: string; name: string; type: string } | null;    // set to start reading
  teamName: string;
  onClose: () => void;
  onSaved: (n: number) => void;
  t: ThemeTokens;
  tr: (k: string, o?: any) => string;
}

export default function InjuryImport({ file, teamName, onClose, onSaved, t, tr }: Props) {
  const s = makeStyles(t);
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!file) return;
    setReading(true);
    setRows(null);
    injuriesAPI.importRead(file, teamName)
      .then((r: any) => setRows((r.injuries ?? []).map((x: any) => ({ ...x, include: true }))))
      .catch((e: any) => {
        Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('injuries.import.readFailed'));
        onClose();
      })
      .finally(() => setReading(false));
  }, [file?.uri]);

  const setRow = (i: number, patch: any) => setRows(prev => prev && prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const nextStatus = (st: string) => INJURY_STATUSES[(INJURY_STATUSES.indexOf(st as any) + 1) % INJURY_STATUSES.length];
  const fmt = (d?: string | null) => d
    ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const what = (r: any) => [[r.side ? tr(`injuries.sides.${r.side}`) : '', r.body_part].filter(Boolean).join(' '), r.description]
    .filter(Boolean).join(' · ') || tr('injuries.unspecified');
  const picked = (rows ?? []).filter(r => r.include);

  const save = async () => {
    if (!picked.length) return;
    setSaving(true);
    try {
      const r = await injuriesAPI.importSave({
        team_name: teamName,
        injuries: picked.map(({ include, jersey, ...rest }) => rest),
      });
      onSaved((r.saved ?? 0) + (r.updated ?? 0));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('common.somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={!!file} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{tr('injuries.import.title')}</Text>
              <Text style={s.sub}>{teamName}</Text>
            </View>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
          </View>
          {reading || !rows ? (
            <View style={{ alignItems: 'center', paddingVertical: 30, gap: 10 }}>
              <ActivityIndicator color={t.accent} />
              <Text style={s.sub}>{tr('injuries.import.reading')}</Text>
            </View>
          ) : rows.length === 0 ? (
            <Text style={[s.sub, { paddingVertical: 20 }]}>{tr('injuries.import.none')}</Text>
          ) : (
            <>
              <Text style={s.hint}>{tr('injuries.import.hint')}</Text>
              <ScrollView style={{ maxHeight: 440 }}>
                {rows.map((r, i) => {
                  const c = statusColor(r.status, t);
                  return (
                    <View key={i} style={[s.row, !r.include && { opacity: 0.45 }]}>
                      <TouchableOpacity onPress={() => setRow(i, { include: !r.include })} hitSlop={8}
                                        accessibilityLabel={tr('injuries.import.include')}>
                        <Ionicons name={r.include ? 'checkbox' : 'square-outline'} size={20} color={r.include ? t.accent : t.muted2} />
                      </TouchableOpacity>
                      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Text style={s.name}>{r.jersey ? `#${r.jersey}  ` : ''}{r.player_name}</Text>
                          <Text style={[s.badge, { color: r.player_id ? t.positive : t.muted }]}>
                            {r.player_id ? tr('injuries.import.onRoster') : tr('injuries.import.byName')}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {/* Tap the status to change it. */}
                          <TouchableOpacity onPress={() => setRow(i, { status: nextStatus(r.status) })}
                                            style={[s.pill, { borderColor: c }]}>
                            <Text style={[s.pillText, { color: c }]}>{tr(`injuries.status.${r.status}`)}</Text>
                          </TouchableOpacity>
                          <Text style={s.what}>{what(r)}</Text>
                        </View>
                        <Text style={s.meta}>
                          {[r.injured_on ? tr('injuries.since', { date: fmt(r.injured_on) }) : '',
                            r.expected_return ? tr('injuries.expReturn', { date: fmt(r.expected_return) }) : '',
                            r.returned_on ? tr('injuries.returned', { date: fmt(r.returned_on) }) : ''].filter(Boolean).join(' · ')}
                        </Text>
                        {!!r.notes && <Text style={s.meta}>{r.notes}</Text>}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
              <TouchableOpacity style={[s.cta, (!picked.length || saving) && { opacity: 0.5 }]} disabled={!picked.length || saving}
                                onPress={save}>
                {saving ? <ActivityIndicator color={t.ctaText} />
                  : <Text style={s.ctaText}>{tr('injuries.import.save', { count: picked.length })}</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Sheet>
  );
}

const makeStyles = (t: ThemeTokens) => ({
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'center' as const, padding: 20 },
  sheet: { backgroundColor: t.sheet, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(760) },
  title: { color: t.ink, fontSize: 17, fontFamily: fonts[800] },
  sub: { color: t.muted, fontSize: 13 },
  hint: { color: t.muted2, fontSize: 12, marginBottom: 8 },
  row: { flexDirection: 'row' as const, gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.divider },
  name: { color: t.ink, fontSize: 14, fontFamily: fonts[800] },
  badge: { fontSize: 11, fontFamily: fonts[700] },
  pill: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 11, fontFamily: fonts[800] },
  what: { color: t.inkSoft, fontSize: 13, fontFamily: fonts[700] },
  meta: { color: t.muted, fontSize: 12 },
  cta: { backgroundColor: t.ctaBg, borderRadius: 12, paddingVertical: 13, alignItems: 'center' as const, marginTop: 12 },
  ctaText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 14 },
});
