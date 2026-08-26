/**
 * One line of a training checklist, with the work behind it a tap away.
 *
 * A row said "Ball handling, both hands" and 20 min, and what that actually
 * meant — the sets, the reps, the coaching points — was further down the page
 * inside the full program. A player had to leave the checklist, find the right
 * part of the program, read it, and come back to tick the box. The chevron
 * opens those same lines where the row already is.
 *
 * TWO TARGETS, NOT ONE NESTED IN ANOTHER
 *
 * The card is a plain View. The tick area and the chevron are separate
 * touchables side by side, rather than a chevron sitting inside a row that is
 * itself pressable. Nested touchables leave which one answers a press up to the
 * platform, and this row cannot afford the ambiguity: the two actions are
 * "mark this done" and "show me what it is".
 *
 * A row with nothing written under it has no chevron at all. A control that
 * opens nothing is worse than no control, because pressing it looks broken.
 *
 * Written once and used by both training screens. They had the same twenty
 * lines of row markup copied between them already, and a checklist that
 * behaves differently depending on who sent the program is the kind of
 * difference nobody decides on and everybody has to remember.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { fonts } from '../theme/typography';
import type { Drill } from '../utils/trainingDrills';

export default function DrillRow({
  drill, done, onToggle, expandLabel, collapseLabel,
}: {
  drill: Drill;
  done: boolean;
  onToggle: () => void;
  expandLabel: string;
  collapseLabel: string;
}) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const hasDetail = (drill.detail?.length ?? 0) > 0;

  return (
    <View style={{
      backgroundColor: t.card, borderRadius: 16, marginBottom: 11,
      borderWidth: 1, borderColor: t.cardBorder, overflow: 'hidden',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity
          onPress={onToggle}
          activeOpacity={0.7}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 13, padding: 15 }}
        >
          <View style={{
            width: 26, height: 26, borderRadius: 8, alignItems: 'center',
            justifyContent: 'center', flexShrink: 0,
            ...(done ? { backgroundColor: t.pistachio }
                     : { borderWidth: 2, borderColor: t.line }),
          }}>
            {done && <Ionicons name="checkmark" size={15} color="#16201A" />}
          </View>
          {/* A long translated label clips here; the checkbox never moves. */}
          <View style={{ flex: 1, flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={{
              color: done ? t.muted : t.ink, fontSize: 15.5, flexShrink: 1,
              fontFamily: done ? fonts[700] : fonts[800],
              ...(done ? { textDecorationLine: 'line-through' as const } : null),
            }}>{drill.label}</Text>
            {!!drill.meta && (
              <Text numberOfLines={1} style={{
                color: t.muted2, fontSize: 12.5, marginTop: 1, flexShrink: 1,
              }}>{drill.meta}</Text>
            )}
          </View>
        </TouchableOpacity>

        {hasDetail && (
          <TouchableOpacity
            onPress={() => setOpen(o => !o)}
            accessibilityLabel={open ? collapseLabel : expandLabel}
            accessibilityRole="button"
            // Padding is the target and it reaches the card's edge, because
            // hitSlop does nothing on the web. Measured earlier in this app: a
            // press six pixels outside a control did not register.
            style={{ paddingVertical: 16, paddingHorizontal: 15, alignSelf: 'stretch',
                     justifyContent: 'center' }}
          >
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18}
                      color={t.muted2} />
          </TouchableOpacity>
        )}
      </View>

      {hasDetail && open && (
        <View style={{
          paddingHorizontal: 15, paddingBottom: 14, paddingTop: 2,
          borderTopWidth: 1, borderTopColor: t.divider, marginTop: 2,
        }}>
          {drill.detail.map((line, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Text style={{ color: t.muted2, fontSize: 14, lineHeight: 21 }}>•</Text>
              <Text style={{
                flex: 1, color: t.inkSoft, fontSize: 14, lineHeight: 21,
              }}>{line}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
