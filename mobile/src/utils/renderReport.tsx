import React from 'react';
import { Text, View } from 'react-native';
import { fonts } from '../theme/typography';

/**
 * renderReport — strips ALL markdown syntax from AI-generated report text
 * and renders it as React Native elements with proper bold headers.
 *
 * Rules:
 *  - Lines that are ALL CAPS, or short (<60 chars) lines ending with ':'
 *    are rendered as bold header text
 *  - "Day N" lines render as sub-headers so day blocks stand apart
 *  - Leading "- ", "*", "·", "•", "▪", "◦", "–" become proper bullets with a
 *    hanging indent
 *  - All markdown syntax (##, **, ---, ===, ———, etc.) is stripped
 *  - Blank lines become a small spacer View
 *  - Body/bullet lines get breathing room so items don't run together
 */
export function renderReport(
  text: string,
  colors: { heading: string; body: string } = { heading: '#f3f4f6', body: '#d1d5db' },
): React.ReactElement[] {
  if (!text) return [];

  const lines = text
    .split('\n')
    .map(line => {
      // Drop pure divider lines — any line made only of separator characters
      // (dashes, equals, underscores, box-drawing, dots, tildes, etc.).
      if (/^[\s\-=—─━_~.·*•]*$/.test(line) && (line.match(/[-=—─━_~.·*•]/g)?.length ?? 0) >= 3) {
        return { text: '', bullet: false, mdHeading: false };
      }
      const mdHeading = /^#{1,6}\s/.test(line);
      // Strip leading ##+ headings
      line = line.replace(/^#{1,6}\s*/, '');
      // Strip ** bold markers
      line = line.replace(/\*\*/g, '');
      // Strip single * italic markers
      line = line.replace(/\*([^*]+)\*/g, '$1');
      // Strip _italic_ markers
      line = line.replace(/_([^_]+)_/g, '$1');
      // Strip `code` markers
      line = line.replace(/`([^`]*)`/g, '$1');
      // Detect a leading bullet marker (dash, asterisk, middot, bullet, etc.)
      const bullet = /^\s*[-*·•▪◦–]\s+/.test(line);
      if (bullet) {
        line = line.replace(/^\s*[-*·•▪◦–]\s+/, '');
      } else {
        // Strip trailing/leading divider runs embedded in a line
        line = line.replace(/^[-=—─━_~]{2,}\s*/, '').replace(/\s*[-=—─━_~]{2,}$/, '');
      }
      return { text: line, bullet, mdHeading };
    });

  const elements: React.ReactElement[] = [];
  let consecutiveBlanks = 0;

  lines.forEach((entry, index) => {
    const line = entry.text;
    const trimmed = line.trim();

    if (trimmed === '') {
      consecutiveBlanks++;
      if (consecutiveBlanks === 1) {
        elements.push(<View key={`spacer-${index}`} style={{ height: 9 }} />);
      }
      return;
    }

    consecutiveBlanks = 0;

    const isAllCaps = /^[A-Z][A-Z0-9\s/&\-().,':]+$/.test(trimmed);
    const isShortHeader = trimmed.length < 60 && trimmed.endsWith(':');
    const isDay = /^day\s|^days\s|^week\s\d/i.test(trimmed);

    if (!entry.bullet && (entry.mdHeading || isAllCaps || isShortHeader)) {
      // Section headings — underlined, larger, well-spaced.
      elements.push(
        <View
          key={`line-${index}`}
          style={{ marginTop: 18, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.heading, paddingBottom: 4, alignSelf: 'flex-start' }}
        >
          <Text style={{ fontFamily: fonts[800], fontSize: 16.5, letterSpacing: 0.2, color: colors.heading }}>
            {trimmed}
          </Text>
        </View>
      );
    } else if (!entry.bullet && isDay) {
      // Day / week sub-headers so each day block reads as its own group.
      elements.push(
        <Text
          key={`line-${index}`}
          style={{ fontFamily: fonts[700], fontSize: 14.5, color: colors.heading, marginTop: 12, marginBottom: 5 }}
        >
          {trimmed}
        </Text>
      );
    } else if (entry.bullet) {
      // Bulleted item with a hanging indent.
      elements.push(
        <View key={`line-${index}`} style={{ flexDirection: 'row', marginBottom: 7, paddingLeft: 6 }}>
          <Text style={{ fontSize: 14.5, lineHeight: 23, color: colors.body, marginRight: 8 }}>•</Text>
          <Text style={{ fontSize: 14.5, lineHeight: 23, color: colors.body, flex: 1 }}>{trimmed}</Text>
        </View>
      );
    } else {
      elements.push(
        <Text
          key={`line-${index}`}
          style={{ fontSize: 14.5, lineHeight: 23, color: colors.body, marginBottom: 7 }}
        >
          {line}
        </Text>
      );
    }
  });

  return elements;
}
