import React from 'react';
import { Text, View, ScrollView } from 'react-native';
import { fonts } from '../theme/typography';

/**
 * renderReport — strips markdown syntax from AI-generated report text and
 * renders it as React Native elements: bold section headers, bullets, and
 * real tables for markdown pipe tables (box scores, pillar grades, etc.).
 */

const isDividerLine = (line: string) =>
  /^[\s\-=—─━═╍╌┄┅_~.·*•]*$/.test(line) && (line.match(/[-=—─━═╍╌┄┅_~.·*•]/g)?.length ?? 0) >= 3;

// A markdown table row: has at least one interior pipe.
const isTableRow = (line: string) => /\|/.test(line) && /^\s*\|?.*\|.*$/.test(line) && line.trim().includes('|');
// The |---|---| separator row under a table header.
const isTableSeparator = (line: string) =>
  /\|/.test(line) && /^[\s|:\-—─]+$/.test(line) && line.includes('-');

function parseCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => stripInline(c.trim()));
}

function stripInline(s: string): string {
  return s
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]*)`/g, '$1');
}

// ── How wide a table's columns are ────────────────────────────────────────────
// Every column used to be 108px, whatever was in it and whatever room the page
// had. That is why a four-column table sat at 432px in the middle of a 1450px
// page while its "Film Read" column wrapped to six lines and its "Grade" column
// — holding the word "B+" — was given exactly as much space.
//
// Columns are sized by their contents now, and a table takes only the width it
// needs. Where there is room to spare, some of it goes to the columns that
// actually wanted more, so long cells stop wrapping; a table never grows past
// the width of the text around it, so the page still reads as one column.

const COL_MIN = 72;        // narrow enough for "PTS", wide enough to read
const COL_IDEAL_MAX = 300; // a column's natural size stops here
const COL_GROW_MAX = 560;  // ...and it may grow to here if the page has room
const CHAR_W = 6.6;        // ~advance per character at 12.5px
const CELL_PAD = 18;
const LEGACY_COL_W = 108;  // the old fixed width — still the budget when scrolling
// How much of the leftover room a table may claim. Well short of 1: "a little
// more space", not "all of it".
const GROWTH_SHARE = 0.6;

function columnWidths(
  header: string[], rows: string[][], cols: number, available: number,
): number[] {
  const want: number[] = [];
  for (let i = 0; i < cols; i++) {
    let longest = (header[i] ?? '').length;
    for (const r of rows) longest = Math.max(longest, (r[i] ?? '').length);
    want.push(Math.min(COL_GROW_MAX, longest * CHAR_W + CELL_PAD));
  }
  const ideal = want.map(w => Math.min(COL_IDEAL_MAX, Math.max(COL_MIN, w)));
  const natural = ideal.reduce((a, b) => a + b, 0);

  // Not measured yet, or it fits: content-sized, plus a share of what's left
  // given to the columns still asking for more.
  if (!available || natural <= available) {
    const demand = want.map((w, i) => Math.max(0, w - ideal[i]));
    const total = demand.reduce((a, b) => a + b, 0);
    const slack = available ? available - natural : 0;
    if (total <= 0 || slack <= 0) return ideal;
    const grant = Math.min(slack * GROWTH_SHARE, total);
    return ideal.map((w, i) => Math.round(w + (grant * demand[i]) / total));
  }

  // Too wide for the space — a phone, or a box score's eleven columns. Share
  // out the width the old fixed layout would have taken, so the table scrolls
  // exactly as far sideways as it always did while its columns finally reflect
  // what is in them.
  const budget = Math.max(available, cols * LEGACY_COL_W);
  const scale = budget / natural;
  return ideal.map(w => Math.max(COL_MIN, Math.round(w * scale)));
}

function TableBlock({ header, rows, colors }: {
  header: string[]; rows: string[][]; colors: { heading: string; body: string };
}): React.ReactElement {
  // The width of the text column this table sits in, which is the most a table
  // is ever allowed to be. Measured rather than assumed: the same report is
  // rendered in a phone screen, a desktop page and an 820px modal.
  const [available, setAvailable] = React.useState(0);
  const cols = Math.max(header.length, ...rows.map(r => r.length));
  const widths = columnWidths(header, rows, cols, available);
  const total = widths.reduce((a, b) => a + b, 0);
  const scrolls = !!available && total > available + 1;

  // Gray-alpha borders/fills read on BOTH light and dark backgrounds (white-alpha
  // was invisible in light mode).
  const border = 'rgba(128,128,128,0.4)';
  const headerBg = 'rgba(128,128,128,0.14)';
  const cell = (text: string, i: number, bold: boolean) => (
    <View key={i} style={{ width: widths[i], paddingVertical: 7, paddingHorizontal: 8, borderRightWidth: i < cols - 1 ? 1 : 0, borderRightColor: border }}>
      <Text style={{ fontSize: 12.5, lineHeight: 18, color: bold ? colors.heading : colors.body, fontFamily: bold ? fonts[700] : fonts[400] }}>
        {text}
      </Text>
    </View>
  );
  const table = (
    // alignSelf keeps a small table small: without it the bordered box stretches
    // to the row's full width and the last column's right edge floats away from
    // its content.
    <View style={{ borderWidth: 1, borderColor: border, borderRadius: 8, overflow: 'hidden', alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', backgroundColor: headerBg, borderBottomWidth: 1, borderBottomColor: border }}>
        {Array.from({ length: cols }).map((_, i) => cell(header[i] ?? '', i, true))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={{ flexDirection: 'row', borderBottomWidth: ri < rows.length - 1 ? 1 : 0, borderBottomColor: border }}>
          {Array.from({ length: cols }).map((_, i) => cell(r[i] ?? '', i, false))}
        </View>
      ))}
    </View>
  );
  return (
    <View style={{ marginVertical: 10 }} onLayout={e => setAvailable(e.nativeEvent.layout.width)}>
      {scrolls
        ? <ScrollView horizontal showsHorizontalScrollIndicator={false}>{table}</ScrollView>
        : table}
    </View>
  );
}

function renderTable(
  header: string[],
  rows: string[][],
  colors: { heading: string; body: string },
  key: string,
): React.ReactElement {
  return <TableBlock key={key} header={header} rows={rows} colors={colors} />;
}

function renderLine(raw: string, index: number, colors: { heading: string; body: string }): React.ReactElement | null {
  const mdHeading = /^#{1,6}\s/.test(raw);
  let line = stripInline(raw);
  const bullet = /^\s*[-*·•▪◦–]\s+/.test(line);
  if (bullet) {
    line = line.replace(/^\s*[-*·•▪◦–]\s+/, '');
  } else {
    line = line.replace(/^[-=—─━═_~]{2,}\s*/, '').replace(/\s*[-=—─━═_~]{2,}$/, '');
  }
  const trimmed = line.trim();
  if (trimmed === '') return null;

  const isAllCaps = /^[A-Z][A-Z0-9\s/&\-().,':]+$/.test(trimmed);
  const isShortHeader = trimmed.length < 60 && trimmed.endsWith(':');
  const isDay = /^day\s|^days\s|^week\s\d/i.test(trimmed);

  if (!bullet && (mdHeading || isAllCaps || isShortHeader)) {
    return (
      <View key={`line-${index}`} style={{ marginTop: 18, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.heading, paddingBottom: 4, alignSelf: 'flex-start' }}>
        <Text style={{ fontFamily: fonts[800], fontSize: 16.5, letterSpacing: 0.2, color: colors.heading }}>{trimmed}</Text>
      </View>
    );
  }
  if (!bullet && isDay) {
    return (
      <Text key={`line-${index}`} style={{ fontFamily: fonts[700], fontSize: 14.5, color: colors.heading, marginTop: 12, marginBottom: 5 }}>{trimmed}</Text>
    );
  }
  if (bullet) {
    // Block layout (not a flex row): the bullet is absolutely positioned and the
    // text is a normal full-width Text that wraps naturally. A flex-row with a
    // flex:1 Text intermittently mis-measures and clips a line mid-word in RN.
    return (
      <View key={`line-${index}`} style={{ marginBottom: 7, paddingLeft: 20 }}>
        <Text style={{ position: 'absolute', left: 6, top: 0, fontSize: 14.5, lineHeight: 23, color: colors.body }}>•</Text>
        <Text style={{ fontSize: 14.5, lineHeight: 23, color: colors.body }}>{trimmed}</Text>
      </View>
    );
  }
  return (
    <Text key={`line-${index}`} style={{ fontSize: 14.5, lineHeight: 23, color: colors.body, marginBottom: 7 }}>{line}</Text>
  );
}

export function renderReport(
  text: string,
  colors: { heading: string; body: string } = { heading: '#f3f4f6', body: '#d1d5db' },
): React.ReactElement[] {
  if (!text) return [];
  const rawLines = text.split('\n');
  const elements: React.ReactElement[] = [];
  let i = 0;
  let consecutiveBlanks = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    // Markdown table: a row followed by a |---| separator.
    if (isTableRow(line) && i + 1 < rawLines.length && isTableSeparator(rawLines[i + 1])) {
      const header = parseCells(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < rawLines.length && isTableRow(rawLines[j]) && !isTableSeparator(rawLines[j])) {
        rows.push(parseCells(rawLines[j]));
        j++;
      }
      elements.push(renderTable(header, rows, colors, `table-${i}`));
      i = j;
      consecutiveBlanks = 0;
      continue;
    }

    if (isDividerLine(line)) { i++; continue; }

    if (line.trim() === '') {
      consecutiveBlanks++;
      if (consecutiveBlanks === 1) elements.push(<View key={`spacer-${i}`} style={{ height: 9 }} />);
      i++;
      continue;
    }
    consecutiveBlanks = 0;
    const el = renderLine(line, i, colors);
    if (el) elements.push(el);
    i++;
  }
  return elements;
}
