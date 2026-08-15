import React from 'react';
import { Text, View, ScrollView } from 'react-native';
import { fonts } from '../theme/typography';

/**
 * renderReport — strips markdown syntax from AI-generated report text and
 * renders it as React Native elements: bold section headers, bullets, and
 * real tables for markdown pipe tables (box scores, pillar grades, etc.).
 *
 * It can also search itself. A report runs to several pages and finding a
 * player's name in one meant scrolling and reading — the browser's own Ctrl+F
 * does not reach a React Native view, and there is no browser at all on the
 * phone. So the text is walked once into blocks, and both the count and the
 * render come off that same walk: what the counter says is "12 matches" is
 * exactly what gets highlighted, rather than two passes that can disagree.
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

// ── Searching the text that is actually on screen ────────────────────────────
//
// Matching happens on the rendered strings, not the markdown, so a search for
// "**Points**" is not a match and a search for "Points" is — the coach is
// looking for what they can see.

/** Where `query` appears in `text`, case-insensitively. */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const q = (query ?? '').trim().toLowerCase();
  if (!q || !text) return [];
  const hay = text.toLowerCase();
  const out: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(q, from);
    if (at < 0) break;
    out.push([at, at + q.length]);
    from = at + q.length;   // no overlapping matches, same as a browser's find
  }
  return out;
}

/**
 * What the search bar needs from a rendered block of text.
 *
 * `first` is the number this block's first match carries in the whole report,
 * which is how the active match is found again when it is two hundred lines
 * further down.
 */
export type ReportSearch = {
  query: string;
  /** 0-based index of the match the arrows are currently sitting on. */
  active: number;
  /**
   * Handed the view drawing the active match, so the arrows can scroll to it.
   *
   * The active one only, rather than every block that has a hit: keeping a map
   * of all of them meant a key from the previous keystroke could outlive the
   * render that made it, and the arrows then had nowhere to jump to.
   */
  registerActive?: (node: any) => void;
};

type Counter = { n: number };

/** A run of text with the matches inside it picked out. */
function Hi({ text, style, search, counter }: {
  text: string;
  style: any;
  search?: ReportSearch;
  counter?: Counter;
}): React.ReactElement {
  const ranges = search ? matchRanges(text, search.query) : [];
  if (!search || ranges.length === 0) {
    if (counter) counter.n += 0;
    return <Text style={style}>{text}</Text>;
  }
  const base = counter ? counter.n : 0;
  if (counter) counter.n += ranges.length;

  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], k) => {
    if (s > at) parts.push(<Text key={`t${k}`}>{text.slice(at, s)}</Text>);
    const isActive = base + k === search.active;
    parts.push(
      <Text
        key={`m${k}`}
        ref={isActive ? (n: any) => { search.registerActive?.(n); } : undefined}
        style={{
          // The one the arrows are on is the strong colour; the rest are the
          // softer wash a browser uses, so "where am I" is answerable at a
          // glance without losing sight of the others.
          backgroundColor: isActive ? '#f59e0b' : 'rgba(245,158,11,0.32)',
          color: isActive ? '#1f2937' : undefined,
        }}
      >
        {text.slice(s, e)}
      </Text>,
    );
    at = e;
  });
  if (at < text.length) parts.push(<Text key="tail">{text.slice(at)}</Text>);
  return <Text style={style}>{parts}</Text>;
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

function TableBlock({ header, rows, colors, search, base, sizingRows }: {
  header: string[]; rows: string[][]; colors: { heading: string; body: string };
  search?: ReportSearch; base?: number; sizingRows?: string[][];
}): React.ReactElement {
  // The width of the text column this table sits in, which is the most a table
  // is ever allowed to be. Measured rather than assumed: the same report is
  // rendered in a phone screen, a desktop page and an 820px modal.
  const [available, setAvailable] = React.useState(0);
  // Sized from every table in this report that has the same headings, not
  // from this one alone. Two box scores are the same table twice — one per
  // team — and sizing each to its own longest name printed them at two
  // different widths, one above the other, on a page a coach reads as a pair.
  const sizeFrom = sizingRows ?? rows;
  const cols = Math.max(header.length, ...sizeFrom.map(r => r.length), ...rows.map(r => r.length));
  const widths = columnWidths(header, sizeFrom, cols, available);
  const total = widths.reduce((a, b) => a + b, 0);
  const scrolls = !!available && total > available + 1;

  // Counted in the same order the cells are drawn — header left to right, then
  // each row — which is the order the walk counts them in.
  const counter: Counter = { n: base ?? 0 };

  // Gray-alpha borders/fills read on BOTH light and dark backgrounds (white-alpha
  // was invisible in light mode).
  const border = 'rgba(128,128,128,0.4)';
  const headerBg = 'rgba(128,128,128,0.14)';
  const cell = (text: string, i: number, bold: boolean) => (
    <View key={i} style={{ width: widths[i], paddingVertical: 7, paddingHorizontal: 8, borderRightWidth: i < cols - 1 ? 1 : 0, borderRightColor: border }}>
      <Hi
        text={text}
        search={search}
        counter={counter}
        style={{ fontSize: 12.5, lineHeight: 18, color: bold ? colors.heading : colors.body, fontFamily: bold ? fonts[700] : fonts[400] }}
      />
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

// ── The walk ─────────────────────────────────────────────────────────────────
//
// One pass over the text producing the blocks the screen will draw. Counting
// matches and drawing them both read this, so they cannot drift apart.

type LineKind = 'heading' | 'day' | 'bullet' | 'body';
type Block =
  | { kind: 'line'; index: number; line: LineKind; text: string }
  | { kind: 'table'; index: number; header: string[]; rows: string[][] }
  | { kind: 'spacer'; index: number };

function parseLine(raw: string): { line: LineKind; text: string } | null {
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

  if (!bullet && (mdHeading || isAllCaps || isShortHeader)) return { line: 'heading', text: trimmed };
  if (!bullet && isDay) return { line: 'day', text: trimmed };
  if (bullet) return { line: 'bullet', text: trimmed };
  // A plain paragraph keeps its leading spaces, as it always has.
  return { line: 'body', text: line };
}

function walkReport(text: string): Block[] {
  if (!text) return [];
  const rawLines = text.split('\n');
  const blocks: Block[] = [];
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
      blocks.push({ kind: 'table', index: i, header, rows });
      i = j;
      consecutiveBlanks = 0;
      continue;
    }

    if (isDividerLine(line)) { i++; continue; }

    if (line.trim() === '') {
      consecutiveBlanks++;
      if (consecutiveBlanks === 1) blocks.push({ kind: 'spacer', index: i });
      i++;
      continue;
    }
    consecutiveBlanks = 0;
    const parsed = parseLine(line);
    if (parsed) blocks.push({ kind: 'line', index: i, ...parsed });
    i++;
  }
  return blocks;
}

/** Every string a block puts on screen, in the order it draws them. */
function blockStrings(b: Block): string[] {
  if (b.kind === 'line') return [b.text];
  if (b.kind === 'table') return [...b.header, ...b.rows.flat()];
  return [];
}

/** How many times `query` appears in the report as it is drawn. */
export function countReportMatches(text: string, query: string): number {
  if (!(query ?? '').trim()) return 0;
  let n = 0;
  for (const b of walkReport(text)) {
    for (const s of blockStrings(b)) n += matchRanges(s, query).length;
  }
  return n;
}

function renderBlock(
  b: Block,
  colors: { heading: string; body: string },
  search: ReportSearch | undefined,
  base: number,
  sizingRows?: string[][],
): React.ReactElement {
  const key = b.kind === 'table' ? `table-${b.index}`
    : b.kind === 'spacer' ? `spacer-${b.index}` : `line-${b.index}`;

  if (b.kind === 'spacer') return <View key={key} style={{ height: 9 }} />;
  if (b.kind === 'table') {
    return <TableBlock key={key} header={b.header} rows={b.rows} colors={colors}
                       search={search} base={base} sizingRows={sizingRows} />;
  }

  const counter: Counter = { n: base };
  if (b.line === 'heading') {
    return (
      <View key={key} style={{ marginTop: 18, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.heading, paddingBottom: 4, alignSelf: 'flex-start' }}>
        <Hi text={b.text} search={search} counter={counter}
            style={{ fontFamily: fonts[800], fontSize: 16.5, letterSpacing: 0.2, color: colors.heading }} />
      </View>
    );
  }
  if (b.line === 'day') {
    return (
      <Hi key={key} text={b.text} search={search} counter={counter}
          style={{ fontFamily: fonts[700], fontSize: 14.5, color: colors.heading, marginTop: 12, marginBottom: 5 }} />
    );
  }
  if (b.line === 'bullet') {
    // Block layout (not a flex row): the bullet is absolutely positioned and the
    // text is a normal full-width Text that wraps naturally. A flex-row with a
    // flex:1 Text intermittently mis-measures and clips a line mid-word in RN.
    return (
      <View key={key} style={{ marginBottom: 7, paddingLeft: 20 }}>
        <Text style={{ position: 'absolute', left: 6, top: 0, fontSize: 14.5, lineHeight: 23, color: colors.body }}>•</Text>
        <Hi text={b.text} search={search} counter={counter}
            style={{ fontSize: 14.5, lineHeight: 23, color: colors.body }} />
      </View>
    );
  }
  return (
    <Hi key={key} text={b.text} search={search} counter={counter}
        style={{ fontSize: 14.5, lineHeight: 23, color: colors.body, marginBottom: 7 }} />
  );
}

export function renderReport(
  text: string,
  colors: { heading: string; body: string } = { heading: '#f3f4f6', body: '#d1d5db' },
  search?: ReportSearch,
): React.ReactElement[] {
  if (!text) return [];
  const active = search && (search.query ?? '').trim() ? search : undefined;
  const elements: React.ReactElement[] = [];
  let seen = 0;

  // Tables sharing a set of headings are the same table repeated, so they are
  // measured together and come out the same width.
  const blocks = [...walkReport(text)];
  const shape = (h: string[]) => h.map(x => x.trim().toLowerCase()).join('|');
  const peers = new Map<string, string[][]>();
  for (const b of blocks) {
    if (b.kind !== 'table') continue;
    const k = shape(b.header);
    peers.set(k, [...(peers.get(k) ?? []), ...b.rows]);
  }

  for (const b of blocks) {
    const here = active
      ? blockStrings(b).reduce((n, s) => n + matchRanges(s, active.query).length, 0)
      : 0;
    elements.push(renderBlock(b, colors, active, seen,
                              b.kind === 'table' ? peers.get(shape(b.header)) : undefined));
    seen += here;
  }
  return elements;
}
