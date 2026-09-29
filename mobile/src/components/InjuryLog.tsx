/**
 * A player's injury log, laid out like a team's injury report: what is
 * CURRENT (status, what and where, since when, expected back) and the RECENT
 * injuries they have come back from.
 *
 * Every report that names the player reads this log (api/injuries.py), so a
 * hamstring logged here is in the next scouting report, training program and
 * game report without anyone retyping it.
 *
 * Works for a roster player (playerId) or a player known only by name — an
 * opponent on Scout (teamName + playerName).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { injuriesAPI } from '../api/client';
import { DateField } from './DateRangeFilter';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

export const INJURY_STATUSES = ['out', 'dtd', 'questionable', 'playing_through', 'cleared'] as const;
const BODY_PARTS = ['ankle', 'knee', 'hamstring', 'groin', 'calf', 'foot', 'back', 'hip', 'shoulder',
                    'wrist', 'hand', 'concussion'];
const SIDES = ['left', 'right', 'both'];

/** The colour a status reads in, everywhere a player is tagged with it. */
export const statusColor = (s: string, t: ThemeTokens) =>
  s === 'out' ? t.negative : s === 'dtd' || s === 'questionable' ? t.brown : s === 'cleared' ? t.positive : t.muted;

const normName = (s?: string | null) => (s ?? '').toLowerCase().replace(/#\d+\s*/g, '').split(/\s+/).filter(Boolean).join(' ');

/**
 * The current injuries this coach can see, and a lookup to tag a player with:
 * by roster id when there is one, else by name (and team, when both sides of
 * the match know it). Reloads when `refreshKey` changes.
 */
export function useInjuryTags(refreshKey: any = 0) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    let live = true;
    injuriesAPI.current().then((r: any[]) => { if (live) setRows(r ?? []); }).catch(() => {});
    return () => { live = false; };
  }, [refreshKey]);
  return useCallback((playerName?: string | null, teamName?: string | null, playerId?: number | null) => {
    if (playerId) {
      const byId = rows.find(r => r.player_id === playerId);
      if (byId) return byId;
    }
    const n = normName(playerName);
    if (!n) return null;
    return rows.find(r => normName(r.player_name) === n
      && (!teamName || !r.team_name || normName(r.team_name) === normName(teamName))) ?? null;
  }, [rows]);
}

/** A small status tag beside a player's name: OUT, DTD, Q — or a cross for playing through it. */
export function InjuryTag({ injury, t, tr, size = 'sm' }: { injury: any; t: ThemeTokens; tr: (k: string, o?: any) => string; size?: 'sm' | 'md' }) {
  if (!injury) return null;
  const c = statusColor(injury.status, t);
  const label = injury.status === 'playing_through' ? '' : tr(`injuries.short.${injury.status}`);
  const what = [injury.side ? tr(`injuries.sides.${injury.side}`, { defaultValue: injury.side }) : '', injury.body_part, injury.description]
    .filter(Boolean).join(' ');
  return (
    <View accessibilityLabel={`${tr(`injuries.status.${injury.status}`)}${what ? ` · ${what}` : ''}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: c, borderRadius: 999,
                   paddingHorizontal: size === 'md' ? 7 : 5, paddingVertical: size === 'md' ? 2 : 0, alignSelf: 'center' }}>
      <Ionicons name="medkit" size={size === 'md' ? 11 : 9} color={c} />
      {!!label && <Text style={{ color: c, fontSize: size === 'md' ? 11 : 9.5, fontFamily: fonts[800] }}>{label}</Text>}
    </View>
  );
}

type Draft = { id?: number; status: string; body_part: string; side: string; description: string;
               injured_on: string; expected_return: string; returned_on: string; notes: string };
const today = () => new Date().toISOString().slice(0, 10);
const blank = (): Draft => ({ status: 'out', body_part: '', side: '', description: '', injured_on: today(),
                              expected_return: '', returned_on: '', notes: '' });

interface Props {
  playerId?: number;
  teamName?: string | null;
  playerName?: string;
  t: ThemeTokens;
  tr: (k: string, o?: any) => string;
  style?: any;
  onChange?: () => void;
  refreshKey?: any;              // read again when this changes (an import landed)
}

export default function InjuryLog({ playerId, teamName, playerName, t, tr, style, onChange, refreshKey }: Props) {
  const s = makeStyles(t);
  const [rows, setRows] = useState<any[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    const req = playerId ? injuriesAPI.forPlayer(playerId)
      : injuriesAPI.named(playerName ?? '', teamName ?? undefined);
    req.then(setRows).catch(() => setRows([]));
  }, [playerId, teamName, playerName]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const fmt = (d?: string | null) => d
    ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const what = (i: any) => [
    [i.side ? tr(`injuries.sides.${i.side}`, { defaultValue: i.side }) : '', i.body_part].filter(Boolean).join(' '),
    i.description,
  ].filter(Boolean).join(' · ') || tr('injuries.unspecified');

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    const body: any = {
      status: draft.status, body_part: draft.body_part, side: draft.side, description: draft.description,
      injured_on: draft.injured_on || null, expected_return: draft.expected_return || null,
      returned_on: draft.returned_on || null, notes: draft.notes,
    };
    try {
      if (draft.id) await injuriesAPI.edit(draft.id, body);
      else await injuriesAPI.add({ ...body, player_id: playerId, team_name: teamName, player_name: playerName });
      setDraft(null);
      load();
      onChange?.();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('common.somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  };

  const markReturned = async (i: any) => {
    setRows(prev => prev && prev.map(r => r.id === i.id ? { ...r, returned_on: today(), current: false } : r));
    await injuriesAPI.edit(i.id, { returned_on: today() }).catch(() => {});
    load();
    onChange?.();
  };

  const remove = (i: any) => Alert.alert(tr('injuries.deleteTitle'), '', [
    { text: tr('common.cancel'), style: 'cancel' },
    { text: tr('common.delete'), style: 'destructive', onPress: async () => {
      setRows(prev => prev && prev.filter(r => r.id !== i.id));
      await injuriesAPI.remove(i.id).catch(() => {});
      load();
      onChange?.();
    } },
  ]);

  const edit = (i: any) => setDraft({
    id: i.id, status: i.status, body_part: i.body_part ?? '', side: i.side ?? '', description: i.description ?? '',
    injured_on: i.injured_on ?? '', expected_return: i.expected_return ?? '', returned_on: i.returned_on ?? '',
    notes: i.notes ?? '',
  });

  const current = (rows ?? []).filter(r => r.current);
  const recent = (rows ?? []).filter(r => !r.current);
  const Pill = ({ status }: { status: string }) => {
    const c = statusColor(status, t);
    return (
      <View style={[s.pill, { borderColor: c }]}>
        <Text style={[s.pillText, { color: c }]}>{tr(`injuries.status.${status}`)}</Text>
      </View>
    );
  };
  const Chip = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity style={[s.chip, on && s.chipOn]} onPress={onPress}>
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[s.card, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Text style={[s.label, { flex: 1 }]}>{tr('injuries.title')}</Text>
        {!draft && (
          <TouchableOpacity style={s.addBtn} onPress={() => setDraft(blank())}>
            <Ionicons name="add" size={15} color={t.ctaText} />
            <Text style={s.addText}>{tr('injuries.log')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {draft ? (
        <View style={{ gap: 10 }}>
          <View>
            <Text style={s.field}>{tr('injuries.fields.status')}</Text>
            <View style={s.chips}>
              {INJURY_STATUSES.map(k => (
                <Chip key={k} on={draft.status === k} label={tr(`injuries.status.${k}`)}
                      onPress={() => setDraft({ ...draft, status: k })} />
              ))}
            </View>
          </View>
          <View>
            <Text style={s.field}>{tr('injuries.fields.bodyPart')}</Text>
            <View style={s.chips}>
              {BODY_PARTS.map(k => {
                const label = tr(`injuries.parts.${k}`);
                return <Chip key={k} on={draft.body_part === label} label={label}
                             onPress={() => setDraft({ ...draft, body_part: draft.body_part === label ? '' : label })} />;
              })}
            </View>
            <TextInput style={[s.input, { marginTop: 6 }]} value={draft.body_part} placeholder={tr('injuries.fields.bodyPartOther')}
                       placeholderTextColor={t.muted2} onChangeText={v => setDraft({ ...draft, body_part: v })} />
          </View>
          <View>
            <Text style={s.field}>{tr('injuries.fields.side')}</Text>
            <View style={s.chips}>
              {SIDES.map(k => (
                <Chip key={k} on={draft.side === k} label={tr(`injuries.sides.${k}`)}
                      onPress={() => setDraft({ ...draft, side: draft.side === k ? '' : k })} />
              ))}
            </View>
          </View>
          <View>
            <Text style={s.field}>{tr('injuries.fields.what')}</Text>
            <TextInput style={s.input} value={draft.description} placeholder={tr('injuries.fields.whatPlaceholder')}
                       placeholderTextColor={t.muted2} onChangeText={v => setDraft({ ...draft, description: v })} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <View style={s.dateCol}>
              <DateField label={tr('injuries.fields.injuredOn')} value={draft.injured_on}
                         onChange={v => setDraft({ ...draft, injured_on: v })} />
            </View>
            <View style={s.dateCol}>
              <DateField label={tr('injuries.fields.expectedReturn')} value={draft.expected_return}
                         onChange={v => setDraft({ ...draft, expected_return: v })} />
            </View>
            {!!draft.id && (
              <View style={s.dateCol}>
                <DateField label={tr('injuries.fields.returnedOn')} value={draft.returned_on}
                           onChange={v => setDraft({ ...draft, returned_on: v })} />
              </View>
            )}
          </View>
          <View>
            <Text style={s.field}>{tr('injuries.fields.notes')}</Text>
            <TextInput style={[s.input, { minHeight: 60 }]} multiline textAlignVertical="top" value={draft.notes}
                       placeholder={tr('injuries.fields.notesPlaceholder')} placeholderTextColor={t.muted2}
                       onChangeText={v => setDraft({ ...draft, notes: v })} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={[s.btn, { flex: 1, borderWidth: 1, borderColor: t.line }]} onPress={() => setDraft(null)}>
              <Text style={{ color: t.muted, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: t.ctaBg }]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color={t.ctaText} size="small" />
                : <Text style={{ color: t.ctaText, fontFamily: fonts[800] }}>{tr('common.save')}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : rows === null ? (
        <ActivityIndicator color={t.accent} style={{ marginVertical: 12 }} />
      ) : !rows.length ? (
        <Text style={s.empty}>{tr('injuries.none')}</Text>
      ) : (
        <>
          <Text style={s.section}>{tr('injuries.current')}</Text>
          {current.length === 0 ? <Text style={s.empty}>{tr('injuries.noneCurrent')}</Text> : current.map(i => (
            <View key={i.id} style={s.row}>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Pill status={i.status} />
                  <Text style={s.what}>{what(i)}</Text>
                </View>
                <Text style={s.meta}>
                  {[i.injured_on ? tr('injuries.since', { date: fmt(i.injured_on) }) : '',
                    i.expected_return ? tr('injuries.expReturn', { date: fmt(i.expected_return) }) : ''].filter(Boolean).join(' · ')}
                </Text>
                {!!i.notes && <Text style={s.notes}>{i.notes}</Text>}
                <View style={{ flexDirection: 'row', gap: 14, marginTop: 4 }}>
                  <TouchableOpacity onPress={() => markReturned(i)}>
                    <Text style={s.action}>{tr('injuries.markReturned')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => edit(i)}>
                    <Text style={s.action}>{tr('injuries.edit')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TouchableOpacity onPress={() => remove(i)} accessibilityLabel={tr('injuries.deleteTitle')} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color={t.muted} />
              </TouchableOpacity>
            </View>
          ))}
          {recent.length > 0 && (
            <>
              <Text style={[s.section, { marginTop: 14 }]}>{tr('injuries.recent')}</Text>
              {recent.map(i => (
                <View key={i.id} style={s.row}>
                  <TouchableOpacity style={{ flex: 1, minWidth: 0 }} onPress={() => edit(i)}>
                    <Text style={[s.what, { color: t.inkSoft }]}>{what(i)}</Text>
                    <Text style={s.meta}>
                      {i.returned_on ? tr('injuries.returned', { date: fmt(i.returned_on) }) : tr(`injuries.status.${i.status}`)}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => remove(i)} accessibilityLabel={tr('injuries.deleteTitle')} hitSlop={8}>
                    <Ionicons name="trash-outline" size={16} color={t.muted} />
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
        </>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => ({
  card: { backgroundColor: t.card, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: t.cardBorder } as const,
  label: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase' as const },
  addBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, backgroundColor: t.ctaBg,
            borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  addText: { color: t.ctaText, fontSize: 12.5, fontFamily: fonts[800] },
  section: { color: t.muted, fontSize: 10.5, fontFamily: fonts[800], letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 4 },
  row: { flexDirection: 'row' as const, gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.divider },
  pill: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 11, fontFamily: fonts[800] },
  what: { color: t.ink, fontSize: 14, fontFamily: fonts[700] },
  meta: { color: t.muted, fontSize: 12 },
  notes: { color: t.inkSoft, fontSize: 12.5 },
  action: { color: t.accent, fontSize: 12.5, fontFamily: fonts[700] },
  empty: { color: t.muted2, fontSize: 13, marginVertical: 6 },
  field: { color: t.muted, fontSize: 11, fontFamily: fonts[700], marginBottom: 5 },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  chip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  chipOn: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  chipText: { color: t.inkSoft, fontSize: 12.5, fontFamily: fonts[700] },
  chipTextOn: { color: t.ctaText },
  input: { backgroundColor: t.chip, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, color: t.ink, fontSize: 14 },
  dateCol: { flexGrow: 1, flexBasis: 140, minWidth: 130 },
  btn: { borderRadius: 12, paddingVertical: 11, alignItems: 'center' as const, justifyContent: 'center' as const },
});
