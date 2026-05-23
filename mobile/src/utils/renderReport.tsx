import React from 'react';
import { Text, View } from 'react-native';

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
export function renderReport(text: string): React.ReactElement[] {
  if (!text) return [];

  const lines = text
    .split('\n')
    // Strip all markdown syntax characters from each line
    .map(line => {
      // Drop pure divider lines
      if (/^\s*[-=—─]{3,}\s*$/.test(line)) return '';
      if (/^\s*={3,}\s*$/.test(line)) return '';
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
      return line;
    });

  const elements: React.ReactElement[] = [];
  let consecutiveBlanks = 0;

  lines.forEach((line, index) => {
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
    //   1. ALL CAPS line (may end with ':')
    //   2. Short line (<60 chars) that ends with ':'
    const isAllCaps = /^[A-Z][A-Z0-9\s/&\-().,':]+$/.test(trimmed);
    const isShortHeader = trimmed.length < 60 && trimmed.endsWith(':');

    if (isAllCaps || isShortHeader) {
      elements.push(
        <Text
          key={`line-${index}`}
          style={{ fontWeight: 'bold', fontSize: 15, color: '#e5e7eb', marginTop: 12, marginBottom: 2 }}
        >
          {trimmed}
        </Text>
      );
    } else {
      elements.push(
        <Text
          key={`line-${index}`}
          style={{ fontSize: 14, lineHeight: 22, color: '#d1d5db' }}
        >
          {line}
        </Text>
      );
    }
  });

  return elements;
}
