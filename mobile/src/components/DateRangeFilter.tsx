/**
 * A date range for the lists behind Team Grade: Games, Scout and Game Report.
 *
 * A season's worth of games is a long grid, and the only way through it was
 * the name search. The coach usually knows WHEN a game was better than what it
 * was called ("last week", "this season"), so this narrows the same lists by
 * the date the game was played.
 *
 * One range is shared by all three lists (the screen owns the state and hands
 * it down), because a coach who has narrowed to this season in Games expects
 * Scout and Game Report to be looking at the same season when they switch.
 *
 * The range is kept as a preset plus, for a custom range, two calendar days.
 * The instants it covers are worked out at the moment of use, not stored, so
 * "last 7 days" left on overnight still means the last 7 days in the morning.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../theme/ThemeProvider';
import { useBreakpoint } from '../responsive/useBreakpoint';
import { useCloseOnOutside } from '../hooks/useCloseOnOutside';

export type DatePreset = 'all' | '7d' | '30d' | 'season' | 'custom';

/** `from` and `to` are calendar days, YYYY-MM-DD, in the coach's own time zone. */
export type DateRange = { preset: DatePreset; from?: string; to?: string };

export const ALL_TIME: DateRange = { preset: 'all' };

const PRESETS: DatePreset[] = ['all', '7d', '30d', 'season', 'custom'];

// ── The arithmetic, kept apart from the component so it can be tested alone ──

const pad = (n: number) => String(n).padStart(2, '0');

/** A Date as the calendar day it falls on locally, YYYY-MM-DD. */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Midnight at the start of a local calendar day. */
const startOfDay = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

/** The last instant of a local calendar day, so "to Apr 5" includes Apr 5. */
const endOfDay = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
};

/**
 * When the current season began.
 *
 * The same rule the rest of this screen uses to name a season: it runs August
 * to July, so a game in March belongs to the season that started the August
 * before. See seasonForDate in TeamEvalScreen.
 */
export const seasonStart = (now: Date): Date => {
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 7, 1, 0, 0, 0, 0);
};

/**
 * The instants a range covers. `null` on either side means open-ended.
 *
 * "Last 7 days" is today and the six before it, whole days, not the last
 * 168 hours: a game played at 9am a week ago today is not in it, and one played
 * at 11pm six days ago is.
 */
export function rangeBounds(r: DateRange, now: Date = new Date()):
    { from: Date | null; to: Date | null } {
  const today = dayKey(now);
  const daysBack = (n: number) => {
    const d = startOfDay(today);
    d.setDate(d.getDate() - n);
    return d;
  };
  switch (r.preset) {
    case '7d': return { from: daysBack(6), to: null };
    case '30d': return { from: daysBack(29), to: null };
    case 'season': return { from: seasonStart(now), to: null };
    case 'custom': {
      // Given the wrong way round, the two days are simply swapped rather than
      // matching nothing, which would look like there were no games at all.
      let [a, b] = [r.from, r.to];
      if (a && b && a > b) [a, b] = [b, a];
      return { from: a ? startOfDay(a) : null, to: b ? endOfDay(b) : null };
    }
    default: return { from: null, to: null };
  }
}

/** Whether a game date falls in the range. A game with no date is kept. */
export function inDateRange(value: string | Date | null | undefined,
                            r: DateRange, now: Date = new Date()): boolean {
  if (r.preset === 'all') return true;
  if (!value) return true;
  const when = value instanceof Date ? value : new Date(value);
  if (isNaN(when.getTime())) return true;
  const { from, to } = rangeBounds(r, now);
  if (from && when < from) return false;
  if (to && when > to) return false;
  return true;
}

/** The range as the query parameters the server takes, ISO instants. */
export function rangeParams(r: DateRange, now: Date = new Date()):
    { date_from?: string; date_to?: string } {
  const { from, to } = rangeBounds(r, now);
  const out: { date_from?: string; date_to?: string } = {};
  if (from) out.date_from = from.toISOString();
  if (to) out.date_to = to.toISOString();
  return out;
}

export const isFiltering = (r: DateRange) => r.preset !== 'all';

// ── A single date field that works in a browser as well as on a phone ────────

/**
 * The native date picker renders nothing at all in a browser, and BloomPrint is
 * mostly used in one. So the web gets the browser's own date field, and iOS and
 * Android get the platform picker.
 *
 * Exported for New Game, whose date could not be changed in a browser at all
 * for exactly that reason: pressing it drew nothing, so every game created on
 * the website was dated the day it was entered.
 */
export function DateField({ value, onChange, label, hideLabel, inputStyle }: {
  value?: string; onChange: (v: string) => void;
  /** Always the field's accessible name; shown above it unless hideLabel. */
  label: string;
  /** For a form that already prints its own label over the field. */
  hideLabel?: boolean;
  /** Extra CSS for the browser's field, to match the form it sits in. */
  inputStyle?: Record<string, any>;
}) {
  const { t, mode } = useTheme();
  const [open, setOpen] = useState(false);

  if (Platform.OS === 'web') {
    return (
      <View style={{ gap: 4 }}>
        {!hideLabel && (
          <Text style={{ color: t.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.4 }}>
            {label}
          </Text>
        )}
        {React.createElement('input', {
          type: 'date',
          value: value ?? '',
          'aria-label': label,
          onChange: (e: any) => onChange(e.target.value),
          style: {
            // colorScheme makes the browser draw its calendar in the page's
            // theme; without it the popup is bright white on a dark page.
            colorScheme: mode === 'dark' ? 'dark' : 'light',
            background: t.card, color: t.ink,
            border: `1px solid ${t.line}`, borderRadius: 8,
            padding: '7px 8px', fontSize: 14, fontFamily: 'inherit',
            width: '100%', boxSizing: 'border-box',
            ...(inputStyle ?? {}),
          },
        })}
      </View>
    );
  }

  const shown = value
    ? startOfDay(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.4 }}>{label}</Text>
      <TouchableOpacity
        onPress={() => setOpen(o => !o)}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 borderWidth: 1, borderColor: t.line, borderRadius: 8, padding: 9,
                 backgroundColor: t.card }}
      >
        <Text style={{ color: value ? t.ink : t.muted2, fontSize: 14 }}>{shown || ' '}</Text>
        <Ionicons name="calendar-outline" size={15} color={t.muted} />
      </TouchableOpacity>
      {open && (
        <DateTimePicker
          value={value ? startOfDay(value) : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          themeVariant={mode === 'dark' ? 'dark' : 'light'}
          onChange={(_, d) => {
            if (Platform.OS === 'android') setOpen(false);
            if (d) onChange(dayKey(d));
          }}
        />
      )}
    </View>
  );
}

// ── The control ──────────────────────────────────────────────────────────────

export default function DateRangeFilter({ value, onChange, align = 'right', size = 'compact' }: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  /** Which edge the menu lines up with. It sits at the right of a row. */
  align?: 'left' | 'right';
  /**
   * 'compact' matches a search box, beside which it sits on Scout and Game
   * Report. 'field' matches the taller team picker it sits beside on Games:
   * at the compact size the two boxes did not line up as one row.
   */
  size?: 'compact' | 'field';
}) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { isPhone } = useBreakpoint();
  const [open, setOpen] = useState(false);
  // The custom days being edited, applied only when the coach presses Apply,
  // so the list does not jump about while the first of two dates is picked.
  const [draft, setDraft] = useState<{ from?: string; to?: string }>({});
  const [editingCustom, setEditingCustom] = useState(false);
  const outside = useCloseOnOutside(open, () => { setOpen(false); setEditingCustom(false); });

  const presetLabel = (p: DatePreset) => tr(`dateFilter.${p}`);

  const fmt = (key: string) => startOfDay(key).toLocaleDateString(
    undefined, { month: 'short', day: 'numeric' });

  const label = (() => {
    if (value.preset !== 'custom') return presetLabel(value.preset);
    const { from, to } = value;
    if (from && to) return tr('dateFilter.between', { from: fmt(from), to: fmt(to) });
    if (from) return tr('dateFilter.since', { from: fmt(from) });
    if (to) return tr('dateFilter.until', { to: fmt(to) });
    return presetLabel('all');
  })();

  const active = isFiltering(value);
  const field = size === 'field' && !isPhone;

  const pick = (p: DatePreset) => {
    if (p === 'custom') {
      setDraft({ from: value.from, to: value.to });
      setEditingCustom(true);
      return;
    }
    onChange({ preset: p });
    setOpen(false);
    setEditingCustom(false);
  };

  const apply = () => {
    const { from, to } = draft;
    onChange(from || to ? { preset: 'custom', from, to } : ALL_TIME);
    setOpen(false);
    setEditingCustom(false);
  };

  return (
    <View ref={outside} style={{ position: 'relative', zIndex: 40 }}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={tr('dateFilter.open')}
        onPress={() => { setOpen(o => !o); setEditingCustom(false); }}
        activeOpacity={0.7}
        // The same framed look as the team picker beside it on Games, and
        // lit like the search icon when it is doing something, because a
        // range left on narrows the list with nothing else on screen saying
        // so, and that reads as games having gone missing.
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 6,
          paddingHorizontal: field ? 12 : 10,
          paddingVertical: field ? 12 : isPhone ? 5 : 8,
          borderRadius: field ? 14 : 10, borderWidth: 1,
          borderColor: active ? t.accent : t.line,
          backgroundColor: active ? t.accentSoft : field ? t.chip : t.card,
          maxWidth: isPhone ? 170 : 240,
        }}
      >
        <Ionicons name="calendar-outline" size={15} color={active ? t.accent : t.muted} />
        {/* On a phone the label is only shown when a range is on: an icon is
            enough to say "you can filter by date", and the words are what
            says "you are". */}
        {(!isPhone || active) && (
          <Text style={{ color: active ? t.accent : t.ink, fontSize: field ? 14 : 13, flexShrink: 1 }}
                numberOfLines={1}>
            {label}
          </Text>
        )}
        {!isPhone && (
          <Text style={{ color: t.muted, fontSize: 11 }}>{open ? '▲' : '▼'}</Text>
        )}
      </TouchableOpacity>

      {open && (
        <View style={{
          position: 'absolute', top: '100%', marginTop: 6,
          [align]: 0, width: 250, zIndex: 50,
          borderWidth: 1, borderColor: t.line, borderRadius: 10,
          backgroundColor: t.sheet, overflow: 'hidden',
        }}>
          {PRESETS.map(p => {
            const on = p === 'custom' ? editingCustom || value.preset === 'custom'
                                      : !editingCustom && value.preset === p;
            return (
              <TouchableOpacity
                key={p}
                accessibilityRole="button"
                onPress={() => pick(p)}
                style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: t.line,
                         flexDirection: 'row', alignItems: 'center', gap: 8,
                         backgroundColor: on ? t.accentSoft : 'transparent' }}
              >
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={15}
                          color={on ? t.accent : t.muted2} />
                <Text style={{ color: on ? t.accent : t.inkSoft, fontSize: 14, flex: 1 }}>
                  {presetLabel(p)}
                </Text>
              </TouchableOpacity>
            );
          })}
          {editingCustom && (
            <View style={{ padding: 12, gap: 10 }}>
              <DateField label={tr('dateFilter.from')} value={draft.from}
                         onChange={v => setDraft(d => ({ ...d, from: v || undefined }))} />
              <DateField label={tr('dateFilter.to')} value={draft.to}
                         onChange={v => setDraft(d => ({ ...d, to: v || undefined }))} />
              <TouchableOpacity
                accessibilityRole="button"
                onPress={apply}
                style={{ backgroundColor: t.accent, borderRadius: 8, paddingVertical: 10,
                         alignItems: 'center', marginTop: 2 }}
              >
                <Text style={{ color: t.ctaText, fontSize: 14, fontWeight: '700' }}>
                  {tr('dateFilter.apply')}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
