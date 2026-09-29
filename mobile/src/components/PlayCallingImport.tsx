/**
 * Import play calling after the game: a sheet — a photo of the handwritten
 * one, a PDF, a CSV or Excel file — read into a table the coach corrects
 * before anything is saved. The sheet rarely says whose plays they are, so
 * that is asked, and nothing saves until it is answered.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Sheet from './Sheet';
import { playCallingAPI } from '../api/client';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { sheetCap } from '../responsive/modalSizes';

type Side = 'our' | 'opponent';
type Row = { quarter: number; play: string; result: '+' | '-' | ''; points: number | null; defense: string; player: string };
type Orb = { team: string; quarter: number; count: number; side: Side | null };

interface Props {
  game: any;
  file: { uri: string; name: string; type: string } | null;   // set to start reading
  sideNames: { our: string; opponent: string };
  qLabel: (q: number) => string;
  onClose: () => void;
  onSaved: (n: number) => void;
  t: ThemeTokens;
  tr: (k: string, o?: any) => string;
}

export default function PlayCallingImport({ game, file, sideNames, qLabel, onClose, onSaved, t, tr }: Props) {
  const s = makeStyles(t);
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [orb, setOrb] = useState<Orb[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [side, setSide] = useState<Side | null>(null);
  const [saving, setSaving] = useState(false);

  // Read as soon as a file is handed in.
  useEffect(() => {
    if (!file) return;
    setReading(true);
    setRows(null);
    setSide(null);
    playCallingAPI.importRead(game.id, file)
      .then((r: any) => {
        setRows((r.possessions ?? []).map((x: any) => ({ ...x, result: x.result === '+' || x.result === '-' ? x.result : '' })));
        setOrb((r.orb ?? []).map((o: any) => ({ team: o.team, quarter: o.quarter ?? 0, count: o.count ?? 0, side: o.side ?? null })));
        setTitle(r.title ?? null);
      })
      .catch((e: any) => {
        Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playCalling.import.readFailed'));
        onClose();
      })
      .finally(() => setReading(false));
  }, [file?.uri]);

  const setRow = (i: number, patch: Partial<Row>) => setRows(prev => prev && prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const cycle = (r: Row['result']): Row['result'] => (r === '+' ? '-' : r === '-' ? '' : '+');
  const quarters = Array.from(new Set((rows ?? []).map(r => r.quarter))).sort((a, b) => a - b);
  const scored = (rows ?? []).filter(r => r.result === '+').length;

  const save = async () => {
    if (!rows || !side) return;
    setSaving(true);
    try {
      const r = await playCallingAPI.importSave(game.id, {
        side, possessions: rows, replace: true,
        orb: orb.filter(o => o.side).map(o => ({ side: o.side, quarter: o.quarter, count: o.count })),
      });
      onSaved(r.saved ?? rows.length);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('common.somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={!!file} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.box}>
          <View style={[s.row, { alignItems: 'center', marginBottom: 6 }]}>
            <Text style={s.title}>{tr('playCalling.import.title')}</Text>
            <TouchableOpacity onPress={onClose} style={{ marginLeft: 'auto' }}>
              <Ionicons name="close" size={22} color={t.muted} />
            </TouchableOpacity>
          </View>
          {reading || !rows ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 24 }}>
              <ActivityIndicator color={t.accent} />
              <Text style={{ color: t.muted, fontSize: 14 }}>{tr('playCalling.import.reading')}</Text>
            </View>
          ) : (
            <>
              {!!title && <Text style={s.sheetTitle}>{title}</Text>}
              <Text style={s.hint}>{tr('playCalling.import.checkHint')}</Text>

              <Text style={s.label}>{tr('playCalling.import.whose')}</Text>
              <View style={[s.row, { marginBottom: 6 }]}>
                {(['our', 'opponent'] as Side[]).map(sd => (
                  <TouchableOpacity key={sd} style={[s.sideBtn, side === sd && s.on]} onPress={() => setSide(sd)}>
                    <Text style={[s.sideText, side === sd && s.onText]} numberOfLines={1}>{sideNames[sd]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={s.count}>{tr('playCalling.import.count', { n: rows.length, scored })}</Text>

              <ScrollView style={{ maxHeight: 420 }}>
                {quarters.map(q => (
                  <View key={q} style={{ marginBottom: 10 }}>
                    <Text style={s.qHead}>{qLabel(q)}</Text>
                    <View style={[s.tr, { borderTopWidth: 0 }]}>
                      <Text style={[s.th, { flex: 1 }]}>{tr('playCalling.play')}</Text>
                      <Text style={[s.th, { width: 44, textAlign: 'center' }]}>+/−</Text>
                      <Text style={[s.th, { width: 46 }]}>{tr('playCalling.import.pts')}</Text>
                      <Text style={[s.th, { width: 84 }]}>{tr('playCalling.defense')}</Text>
                      <View style={{ width: 24 }} />
                    </View>
                    {rows.map((r, i) => r.quarter !== q ? null : (
                      <View key={i} style={s.tr}>
                        <TextInput style={[s.cell, { flex: 1 }]} value={r.play} onChangeText={v => setRow(i, { play: v })}
                                   accessibilityLabel={`${qLabel(q)} ${tr('playCalling.play')} ${i + 1}`} />
                        <TouchableOpacity style={[s.res, r.result === '+' && { backgroundColor: t.positiveSoft, borderColor: t.positive },
                                                  r.result === '-' && { backgroundColor: t.negativeSoft, borderColor: t.negative }]}
                                          onPress={() => setRow(i, { result: cycle(r.result) })}
                                          accessibilityLabel={`${tr('playCalling.import.result')} ${i + 1}`}>
                          <Text style={[s.resText, { color: r.result === '+' ? t.positive : r.result === '-' ? t.negative : t.muted2 }]}>
                            {r.result === '+' ? '+' : r.result === '-' ? '−' : '·'}
                          </Text>
                        </TouchableOpacity>
                        <TextInput style={[s.cell, { width: 46, textAlign: 'center' }]} keyboardType="number-pad"
                                   value={r.points == null ? '' : String(r.points)}
                                   onChangeText={v => setRow(i, { points: v.replace(/[^0-9]/g, '') ? Number(v.replace(/[^0-9]/g, '')) : null })} />
                        <TextInput style={[s.cell, { width: 84 }]} value={r.defense} onChangeText={v => setRow(i, { defense: v })} />
                        <TouchableOpacity onPress={() => setRows(prev => prev && prev.filter((_, j) => j !== i))} style={{ width: 24, alignItems: 'center' }}>
                          <Ionicons name="close" size={16} color={t.muted2} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity onPress={() => setRows(prev => {
                      const next = [...(prev ?? [])];
                      let at = -1;
                      next.forEach((r, j) => { if (r.quarter === q) at = j; });
                      next.splice(at + 1, 0, { quarter: q, play: '', result: '', points: null, defense: '', player: '' });
                      return next;
                    })}>
                      <Text style={s.add}>+ {tr('playCalling.import.addRow', { q: qLabel(q) })}</Text>
                    </TouchableOpacity>
                  </View>
                ))}

                {orb.length > 0 && (
                  <View style={{ marginTop: 6 }}>
                    <Text style={s.label}>{tr('playCalling.orb')}</Text>
                    {orb.map((o, i) => (
                      <View key={i} style={[s.row, { alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }]}>
                        <Text style={s.orbLabel}>{o.team || '—'} · {o.quarter ? qLabel(o.quarter) : tr('playCalling.import.wholeGame')}</Text>
                        {(['our', 'opponent'] as Side[]).map(sd => (
                          <TouchableOpacity key={sd} style={[s.chip, o.side === sd && s.on]}
                                            onPress={() => setOrb(prev => prev.map((x, j) => (j === i ? { ...x, side: sd } : x)))}>
                            <Text style={[s.chipText, o.side === sd && s.onText]}>{sideNames[sd]}</Text>
                          </TouchableOpacity>
                        ))}
                        <TextInput style={[s.cell, { width: 50, textAlign: 'center' }]} keyboardType="number-pad" value={String(o.count)}
                                   onChangeText={v => setOrb(prev => prev.map((x, j) => (j === i ? { ...x, count: Number(v.replace(/[^0-9]/g, '') || 0) } : x)))} />
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>

              <View style={[s.row, { marginTop: 14 }]}>
                <TouchableOpacity style={[s.btn, { borderWidth: 1, borderColor: t.line }]} onPress={onClose}>
                  <Text style={{ color: t.muted, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, { backgroundColor: t.ctaBg }, (!side || saving) && { opacity: 0.5 }]}
                                  disabled={!side || saving} onPress={save}>
                  {saving ? <ActivityIndicator color={t.ctaText} />
                          : <Text style={{ color: t.ctaText, fontFamily: fonts[800] }}>
                              {side ? tr('playCalling.import.save', { n: rows.length }) : tr('playCalling.import.pickWhose')}
                            </Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Sheet>
  );
}

const makeStyles = (t: ThemeTokens) => ({
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'center' as const, padding: 16 },
  box: { backgroundColor: t.sheet, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(760) },
  row: { flexDirection: 'row' as const, gap: 8 },
  title: { color: t.ink, fontSize: 18, fontFamily: fonts[800] },
  sheetTitle: { color: t.inkSoft, fontSize: 14, fontFamily: fonts[700], marginBottom: 2 },
  hint: { color: t.muted, fontSize: 12.5, lineHeight: 18, marginBottom: 8 },
  label: { color: t.muted, fontSize: 10.5, fontFamily: fonts[700], letterSpacing: 1, textTransform: 'uppercase' as const, marginTop: 6, marginBottom: 6 },
  sideBtn: { flex: 1, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingVertical: 9, alignItems: 'center' as const },
  sideText: { color: t.inkSoft, fontFamily: fonts[700], fontSize: 13 },
  on: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  onText: { color: t.ctaText },
  count: { color: t.inkSoft, fontSize: 12.5, fontFamily: fonts[700], marginVertical: 6 },
  qHead: { color: t.ink, fontSize: 13, fontFamily: fonts[800], marginBottom: 2 },
  tr: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingVertical: 3, borderTopWidth: 1, borderTopColor: t.divider },
  th: { color: t.muted2, fontSize: 10, fontFamily: fonts[700] },
  cell: { borderWidth: 1, borderColor: t.line, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, color: t.ink,
          backgroundColor: t.card, fontSize: 13 },
  res: { width: 44, height: 30, borderWidth: 1, borderColor: t.line, borderRadius: 8, alignItems: 'center' as const, justifyContent: 'center' as const },
  resText: { fontSize: 16, fontFamily: fonts[800] },
  add: { color: t.accent, fontSize: 12, fontFamily: fonts[700], marginTop: 4 },
  orbLabel: { color: t.inkSoft, fontSize: 12.5, fontFamily: fonts[700], minWidth: 120 },
  chip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { color: t.inkSoft, fontSize: 12, fontFamily: fonts[700] },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' as const },
});
