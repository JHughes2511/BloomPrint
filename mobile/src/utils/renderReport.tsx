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

function renderTable(
  header: string[],
  rows: string[][],
  colors: { heading: string; body: string },
  key: string,
): React.ReactElement {
  const cols = Math.max(header.length, ...rows.map(r => r.length));
  const cellW = 108;
  // Gray-alpha borders/fills read on BOTH light and dark backgrounds (white-alpha
  // was invisible in light mode).
  const border = 'rgba(128,128,128,0.4)';
  const headerBg = 'rgba(128,128,128,0.14)';
  const cell = (text: string, i: number, bold: boolean) => (
    <View key={i} style={{ width: cellW, paddingVertical: 7, paddingHorizontal: 8, borderRightWidth: i < cols - 1 ? 1 : 0, borderRightColor: border }}>
      <Text style={{ fontSize: 12.5, lineHeight: 18, color: bold ? colors.heading : colors.body, fontFamily: bold ? fonts[700] : fonts[400] }}>
        {text}
      </Text>
    </View>
  );
  return (
    <View key={key} style={{ marginVertical: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ borderWidth: 1, borderColor: border, borderRadius: 8, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', backgroundColor: headerBg, borderBottomWidth: 1, borderBottomColor: border }}>
            {Array.from({ length: cols }).map((_, i) => cell(header[i] ?? '', i, true))}
          </View>
          {rows.map((r, ri) => (
            <View key={ri} style={{ flexDirection: 'row', borderBottomWidth: ri < rows.length - 1 ? 1 : 0, borderBottomColor: border }}>
              {Array.from({ length: cols }).map((_, i) => cell(r[i] ?? '', i, false))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
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
