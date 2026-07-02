import React from 'react';
import { Text, View } from 'react-native';
import { fonts } from '../theme/typography';

/**
 * renderReport — strips ALL markdown syntax from AI-generated report text
 * and renders it as React Native elements with proper bold headers.
 *
 * Rules:
 *  - Lines that are ALL CAPS, or short (<60 chars) lines ending with ':'
 *    are rendered as bold header text (fontWeight:'bold', fontSize:15)
 *  - Leading "- " becomes "• "
 *  - All markdown syntax (##, **, ---, ===, ———, etc.) is stripped
 *  - Blank lines become a small spacer View
 *  - All other lines render as normal body text (fontSize:14, lineHeight:22)
 */
export function renderReport(
  text: string,
  colors: { heading: string; body: string } = { heading: '#f3f4f6', body: '#d1d5db' },
): React.ReactElement[] {
  if (!text) return [];

  const lines = text
    .split('\n')
    // Strip all markdown syntax characters from each line; remember which lines
    // were explicit markdown headings (## ...) so they still render as headings.
    .map(line => {
      // Drop pure divider lines
      if (/^\s*[-=—─]{3,}\s*$/.test(line)) return { text: '', mdHeading: false };
      if (/^\s*={3,}\s*$/.test(line)) return { text: '', mdHeading: false };
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
      // Strip trailing/leading === or --- dividers embedded in text
      line = line.replace(/^[-=—─]+\s*/, '').replace(/\s*[-=—─]+$/, '');
      // Convert leading "- " bullets to "• "
      line = line.replace(/^\s*[-*]\s+/, '• ');
      return { text: line, mdHeading };
    });

  const elements: React.ReactElement[] = [];
  let consecutiveBlanks = 0;

  lines.forEach((entry, index) => {
    const line = entry.text;
    const trimmed = line.trim();

    if (trimmed === '') {
      consecutiveBlanks++;
      // Only render one spacer per blank-line group
      if (consecutiveBlanks === 1) {
        elements.push(<View key={`spacer-${index}`} style={{ height: 8 }} />);
      }
      return;
    }

    consecutiveBlanks = 0;

    // Detect header lines:
    //   1. Explicit markdown heading (## ...)
    //   2. ALL CAPS line (may end with ':')
    //   3. Short line (<60 chars) that ends with ':'
    const isAllCaps = /^[A-Z][A-Z0-9\s/&\-().,':]+$/.test(trimmed);
    const isShortHeader = trimmed.length < 60 && trimmed.endsWith(':');

    if (entry.mdHeading || isAllCaps || isShortHeader) {
      // Underlined, larger, well-spaced headings so sections read as distinct
      // blocks instead of one continuous wall of text.
      elements.push(
        <View
          key={`line-${index}`}
          style={{ marginTop: 18, marginBottom: 7, borderBottomWidth: 1, borderBottomColor: colors.heading, paddingBottom: 4, alignSelf: 'flex-start' }}
        >
          <Text style={{ fontFamily: fonts[800], fontSize: 16.5, letterSpacing: 0.2, color: colors.heading }}>
            {trimmed}
          </Text>
        </View>
      );
    } else {
      elements.push(
        <Text
          key={`line-${index}`}
          style={{ fontSize: 14.5, lineHeight: 23, color: colors.body, marginBottom: 2 }}
        >
          {line}
        </Text>
      );
    }
  });

  return elements;
}
