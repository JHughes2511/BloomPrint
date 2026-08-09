import React, { useEffect, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { fonts } from '../theme/typography';

export type UnresolvedLabel = { label: string; sections?: Record<string, number> };

/**
 * "Which team is this?" — asked only when the file did not say.
 *
 * A stat sheet headed "Angola" and "Egypt" needs no question: the names match
 * the game and the sides are decided without bothering anyone. A comparison
 * chart with a red column and a blue column names nobody, and a guess at which
 * is which is indistinguishable from knowledge once it is drawn as a bar —
 * it put one team's totals under the other's name and left the coach reading a
 * Key Stats panel that contradicted the box score below it.
 *
 * So when a label cannot be matched to either team, it is put to the coach
 * before anything is saved, with the label the reader used to describe where it
 * sat on the page.
 */
export default function TeamLabelPrompt({
  labels, ourName, theirName, busy, onCancel, onDone,
}: {
  labels: UnresolvedLabel[];
  ourName: string;
  theirName: string;
  busy?: boolean;
  onCancel: () => void;
  onDone: (sides: Record<string, boolean>) => void;
}) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const [answers, setAnswers] = useState<Record<string, boolean>>({});

  // A fresh question each time a new set of labels arrives; otherwise the
  // previous file's answers would be pre-filled for a page nobody has seen.
  useEffect(() => { setAnswers({}); }, [labels.map(l => l.label).join('|')]);

  const done = labels.every(l => answers[l.label] !== undefined);

  const choice = (label: string, opp: boolean, name: string) => {
    const on = answers[label] === opp;
    return (
      <TouchableOpacity
        key={String(opp)}
        onPress={() => setAnswers(a => ({ ...a, [label]: opp }))}
        style={{
          flexGrow: 1, flexBasis: 120, paddingVertical: 11, paddingHorizontal: 12,
          borderRadius: 10, alignItems: 'center', borderWidth: 1,
          borderColor: on ? t.ctaBg : t.line,
          backgroundColor: on ? t.ctaBg : 'transparent',
        }}
      >
        <Text numberOfLines={1} style={{ color: on ? t.ctaText : t.ink, fontFamily: fonts[700], fontSize: 13 }}>
          {name}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={labels.length > 0} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <View style={{ width: '100%', maxWidth: 520, backgroundColor: t.sheet, borderRadius: 18,
                       padding: 16, borderWidth: 1, borderColor: t.cardBorder }}>
          <Text style={{ color: t.ink, fontSize: 16, fontFamily: fonts[800] }}>
            {tr('gameStats.whichTeamTitle')}
          </Text>
          <Text style={{ color: t.muted, fontSize: 13, marginTop: 4, marginBottom: 12 }}>
            {tr('gameStats.whichTeamHint')}
          </Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {labels.map(l => (
              <View key={l.label} style={{ marginBottom: 14 }}>
                <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[700] }}>{l.label}</Text>
                {!!l.sections && (
                  <Text style={{ color: t.muted2, fontSize: 12, marginTop: 2 }}>
                    {Object.entries(l.sections)
                      .map(([k, n]) => tr(`gameStats.section.${k}`, { count: n as number }))
                      .join(' · ')}
                  </Text>
                )}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {choice(l.label, false, ourName)}
                  {choice(l.label, true, theirName)}
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
            <TouchableOpacity
              style={{ flexGrow: 1, flexBasis: 110, paddingVertical: 12, borderRadius: 10,
                       borderWidth: 1, borderColor: t.line, alignItems: 'center' }}
              onPress={onCancel}
            >
              <Text style={{ color: t.muted, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flexGrow: 1, flexBasis: 170, paddingVertical: 12, borderRadius: 10,
                       backgroundColor: t.ctaBg, alignItems: 'center', opacity: done && !busy ? 1 : 0.5 }}
              disabled={!done || !!busy}
              onPress={() => onDone(answers)}
            >
              <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>{tr('common.continue')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
