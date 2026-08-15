import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '../responsive/useBreakpoint';
import { useTheme } from '../theme/ThemeProvider';
import { fonts } from '../theme/typography';
import { countReportMatches, type ReportSearch } from '../utils/renderReport';

/**
 * Find something in a report without reading the whole thing.
 *
 * A game report runs to several pages and a season summary to more. Looking
 * for one player, or for what was said about the press, meant scrolling and
 * reading — Ctrl+F does not reach a React Native view, and on a phone there is
 * no Ctrl+F at all.
 *
 * The bar is the browser's find, made part of the app: type, every hit is
 * highlighted, the arrows walk them, and the counter says which one of how
 * many is in front of you.
 */

/** Wire a report view up for searching. */
export function useReportSearch(text: string, existingRef?: React.RefObject<any>) {
  // Some screens already hold a ref to the scroll view they scroll about in.
  // Taking theirs rather than asking for a second one on the same view, which
  // would leave whichever attached last as the only live one.
  const ownRef = useRef<any>(null);
  const scrollRef = existingRef ?? ownRef;
  // The view drawing the active match, handed over as it is rendered.
  const activeNode = useRef<any>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const total = useMemo(() => countReportMatches(text, query), [text, query]);

  // Only ever set, never cleared on detach: a fresh active match registers
  // itself on every render that changes it, and a node that has left the page
  // simply does not answer when it is measured.
  const registerActive = useCallback((node: any) => {
    if (node) activeNode.current = node;
  }, []);

  // A new search starts at the first hit rather than wherever the last one
  // ended up.
  useEffect(() => { setActive(0); }, [query, text]);

  /** Put the active match on screen. */
  const jump = useCallback(() => {
    const scroller = scrollRef.current;
    const node = activeNode.current;
    const inner = scroller?.getInnerViewNode?.() ?? scroller?.getInnerViewRef?.();
    if (!scroller || !node?.measureLayout || !inner) return;
    node.measureLayout(
      inner,
      (_x: number, y: number) => {
        // A little above it, so the match is not against the top edge with no
        // sense of what it is part of.
        scroller.scrollTo?.({ y: Math.max(0, y - 120), animated: true });
      },
      () => {},
    );
  }, []);

  // After the render that moved the active highlight, not during it.
  useEffect(() => {
    if (!open || total <= 0) return;
    const id = setTimeout(jump, 0);
    return () => clearTimeout(id);
  }, [open, active, total, query, jump]);

  const step = useCallback((by: number) => {
    if (total <= 0) return;
    setActive(a => (a + by + total) % total);
  }, [total]);

  const close = useCallback(() => { setOpen(false); setQuery(''); }, []);

  // Ctrl+F / ⌘F opens this rather than the browser's own find, which cannot
  // see inside the report anyway — the text is laid out as views, not as one
  // searchable document.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (e: any) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        // A screen can hold several reports — the one on the page and the ones
        // in sheets over it — and each has its own search. Only the ones whose
        // view is actually on screen answer, so Ctrl+F does not quietly open a
        // bar inside a sheet that is shut.
        if (!scrollRef.current) return;
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const search: ReportSearch | undefined = open && query.trim()
    ? { query, active, registerActive }
    : undefined;

  return { scrollRef, search, open, setOpen, query, setQuery, active, total, step, close };
}

export type ReportSearchControls = ReturnType<typeof useReportSearch>;

/** The button that opens the bar. Sits with the other actions on a report. */
export function ReportSearchButton(
  { ctl, onOpen }: { ctl: ReportSearchControls; onOpen?: () => void },
) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { isPhone } = useBreakpoint();
  return (
    <TouchableOpacity
      onPress={() => { if (!ctl.open) onOpen?.(); ctl.setOpen(o => !o); }}
      accessibilityLabel={tr('reportSearch.open')}
      // A square tap target once the word is gone, rather than a wide box with
      // an icon adrift in it.
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        paddingHorizontal: isPhone ? 8 : 10, paddingVertical: 7, borderRadius: 8,
        borderWidth: 1, borderColor: ctl.open ? t.accent : t.line,
        backgroundColor: ctl.open ? t.accentSoft : 'transparent',
      }}
    >
      <Ionicons name={isPhone ? 'search-outline' : 'search'} size={isPhone ? 16 : 14}
                color={ctl.open ? t.accent : t.muted} />
      {/* On a phone the word costs more than it says. A report's title is the
          long thing on that row -- "Coaching Report - Scouting Report" -- and
          the labelled button pushed it into two lines and then clipped it. The
          icon alone is the same control; the accessibility label still reads
          it out. */}
      {!isPhone && (
        <Text style={{ color: ctl.open ? t.accent : t.muted, fontSize: 11.5, fontFamily: fonts[600] }}>
          {tr('reportSearch.open')}
        </Text>
      )}
    </TouchableOpacity>
  );
}

/** The bar itself. Render it directly above the report. */
export function ReportSearchBar({ ctl }: { ctl: ReportSearchControls }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  if (!ctl.open) return null;
  const typed = !!ctl.query.trim();
  const none = typed && ctl.total === 0;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10,
      borderRadius: 10, borderWidth: 1, borderColor: t.line, backgroundColor: t.card,
    }}>
      <Ionicons name="search" size={15} color={t.muted} />
      <TextInput
        autoFocus
        value={ctl.query}
        onChangeText={ctl.setQuery}
        placeholder={tr('reportSearch.placeholder')}
        placeholderTextColor={t.muted2}
        returnKeyType="search"
        onSubmitEditing={() => ctl.step(1)}
        style={{
          flex: 1, minWidth: 0, color: t.ink, fontSize: 13.5, paddingVertical: 4,
          // No outline on web: the bar itself is the box.
          ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
        }}
      />
      {/* How many, and which one. Silent until something has been typed —
          "0 of 0" beside an empty box is not information. */}
      {typed && (
        <Text style={{
          color: none ? t.negative : t.muted, fontSize: 11.5, fontFamily: fonts[600],
        }}>
          {none
            ? tr('reportSearch.none')
            : tr('reportSearch.count', { index: ctl.active + 1, total: ctl.total })}
        </Text>
      )}
      <TouchableOpacity
        onPress={() => ctl.step(-1)}
        disabled={ctl.total === 0}
        accessibilityLabel={tr('reportSearch.previous')}
        style={{ padding: 4, opacity: ctl.total === 0 ? 0.35 : 1 }}
      >
        <Ionicons name="chevron-up" size={16} color={t.ink} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => ctl.step(1)}
        disabled={ctl.total === 0}
        accessibilityLabel={tr('reportSearch.next')}
        style={{ padding: 4, opacity: ctl.total === 0 ? 0.35 : 1 }}
      >
        <Ionicons name="chevron-down" size={16} color={t.ink} />
      </TouchableOpacity>
      <TouchableOpacity onPress={ctl.close} accessibilityLabel={tr('common.close')} style={{ padding: 4 }}>
        <Ionicons name="close" size={16} color={t.muted} />
      </TouchableOpacity>
    </View>
  );
}
