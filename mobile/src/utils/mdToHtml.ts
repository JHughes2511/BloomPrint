/**
 * Converts a markdown string to HTML suitable for expo-print PDFs.
 * Handles: # h1-h3, **bold**, *italic*, - / * bullet lists, 1. numbered lists.
 *
 * Formatting goals:
 *  - Section headings are clearly larger + bold + underlined so they read as headings.
 *  - NO raw markdown symbols (##, **, *, _, `, ---) ever leak into the output.
 *  - Nothing is cut off across page breaks: paragraphs and list items never split,
 *    and a heading is never stranded alone at the bottom of a page.
 */
// A markdown pipe table, recognised by exactly the rules renderReport uses on
// screen — a row of cells followed by a |---|---| separator. Kept in step with
// utils/renderReport.tsx on purpose: the screen drew real tables and the export
// did not, so a box score that read as a grid in the app came out of the PDF as
// a run of paragraphs full of pipe characters.
const isTableRow = (line: string) =>
  /\|/.test(line) && /^\s*\|?.*\|.*$/.test(line) && line.trim().includes('|');
const isTableSeparator = (line: string) =>
  /\|/.test(line) && /^[\s|:\-—─]+$/.test(line) && line.includes('-');

// What the screen treats as a heading, by the same three rules renderReport
// uses: a markdown heading, an ALL-CAPS line, or a short line ending in a
// colon. The export only honoured the first, so a report whose sections were
// ALL-CAPS — which is most of them — came out as an undifferentiated wall of
// paragraphs while the app showed headings.
const isAllCapsHeading = (t: string) => /^[A-Z][A-Z0-9\s/&\-().,':]+$/.test(t);
const isShortHeader = (t: string) => t.length < 60 && t.endsWith(':');

function tableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

export function mdToHtml(md: string): string {
  const lines = (md ?? '').split('\n');
  let html = '';
  let listType: 'ul' | 'ol' | null = null;

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Inline formatting — bold/italic — then strip any stray markdown that remains
  const inline = (s: string) =>
    escape(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/(^|[^\*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>')
      .replace(/`([^`]*)`/g, '$1')
      // Safety net: remove any leftover markdown markers
      .replace(/\*\*/g, '')
      .replace(/(^|\s)#{1,6}\s/g, '$1');

  const closeList = () => {
    if (listType === 'ul') { html += '</ul>'; }
    if (listType === 'ol') { html += '</ol>'; }
    listType = null;
  };

  // page-break helpers
  const noSplit = 'page-break-inside:avoid';
  // A heading has to stay with the section under it. page-break-after:avoid is
  // the CSS for that and the PDF renderer ignores it — its parser only reads
  // "always", "right" and "left" — so a heading could sit alone at the foot of
  // a page with its section overleaf. -pdf-keep-with-next is the rule it does
  // read; the standard one stays for browsers, which print these too.
  const keepWithNext = 'page-break-after:avoid;-pdf-keep-with-next:true';

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.trimEnd();

    // A table, before anything else looks at these lines: a header row of
    // cells followed by the |---| separator, then every row under it.
    if (isTableRow(line) && idx + 1 < lines.length && isTableSeparator(lines[idx + 1])) {
      const header = tableCells(line);
      const body: string[][] = [];
      let j = idx + 2;
      while (j < lines.length && isTableRow(lines[j]) && !isTableSeparator(lines[j])) {
        body.push(tableCells(lines[j]));
        j++;
      }
      closeList();
      // Widths are shared out evenly and the whole table is 100%: the PDF
      // renderer lays tables out on declared widths rather than measuring the
      // text, so a table without them collapses into its first column.
      const cols = Math.max(header.length, ...body.map(r => r.length), 1);
      // A box score is a name and eighteen numbers. Split evenly, the name got
      // the same 5% as PF and came out as two stacked half-words, so the first
      // column of a wide table is given room and the rest share what is left.
      const wide = cols >= 8;
      const firstW = wide ? Math.min(20, (100 / cols) * 2.8) : 100 / cols;
      const restW = wide ? (100 - firstW) / (cols - 1) : 100 / cols;
      const width = (k: number) => (k === 0 ? firstW : restW).toFixed(2);
      // And the cells themselves tighten, because nineteen columns of 11px on a
      // portrait page is more text than the width can hold.
      const cellPad = wide
        ? 'padding:3px 3px;border:0.5px solid #cbd5e1;font-size:8px;line-height:1.3'
        : 'padding:5px 7px;border:0.5px solid #cbd5e1;font-size:11px;line-height:1.45';
      html += `<table width="100%" cellspacing="0" cellpadding="0" `
        + `style="margin:10px 0;border:0.5px solid #cbd5e1;${noSplit}">`;
      html += '<tr>' + Array.from({ length: cols }, (_, k) =>
        `<td width="${width(k)}%" style="${cellPad};background:#eef2f7;font-weight:bold;color:#0f172a">`
        + `${inline(header[k] ?? '')}</td>`).join('') + '</tr>';
      for (const row of body) {
        html += '<tr>' + Array.from({ length: cols }, (_, k) =>
          `<td width="${width(k)}%" style="${cellPad};color:#1f2937">${inline(row[k] ?? '')}</td>`)
          .join('') + '</tr>';
      }
      html += '</table>';
      idx = j - 1;
      continue;
    }

    // Pure divider line — skip entirely
    if (/^\s*([-=_*•]\s*){3,}\s*$/.test(line) || /^\s*[-=—─━═╍╌┄┅]{3,}\s*$/.test(line)) {
      closeList();
      continue;
    }

    if (/^#{3,} /.test(line)) {
      closeList();
      html += `<h4 style="font-size:14px;font-weight:800;color:#222;margin:16px 0 5px;${keepWithNext}">${inline(line.replace(/^#{3,} /, ''))}</h4>`;
    } else if (/^## /.test(line)) {
      closeList();
      html += `<h3 style="font-size:16px;font-weight:800;color:#111;margin:22px 0 7px;border-bottom:1.5px solid #cbd5e1;padding-bottom:4px;${keepWithNext}">${inline(line.slice(3))}</h3>`;
    } else if (/^# /.test(line)) {
      closeList();
      html += `<h2 style="font-size:18px;font-weight:900;color:#0f172a;margin:26px 0 9px;border-bottom:2px solid #94a3b8;padding-bottom:5px;${keepWithNext}">${inline(line.slice(2))}</h2>`;
    } else if (/^[-*•] /.test(line)) {
      if (listType !== 'ul') { closeList(); html += '<ul style="margin:6px 0;padding-left:20px">'; listType = 'ul'; }
      html += `<li style="font-size:12px;line-height:1.7;margin:3px 0;color:#1f2937;${noSplit}">${inline(line.replace(/^[-*•] /, ''))}</li>`;
    } else if (/^\d+\. /.test(line)) {
      if (listType !== 'ol') { closeList(); html += '<ol style="margin:6px 0;padding-left:20px">'; listType = 'ol'; }
      html += `<li style="font-size:12px;line-height:1.7;margin:3px 0;color:#1f2937;${noSplit}">${inline(line.replace(/^\d+\. /, ''))}</li>`;
    } else if (line.trim() === '') {
      closeList();
      html += '<div style="height:8px"></div>';
    } else {
      closeList();
      const trimmed = line.trim();
      if (isAllCapsHeading(trimmed) || isShortHeader(trimmed)) {
        // The same treatment a markdown heading gets, because that is what the
        // screen gives all three.
        html += `<h3 style="font-size:16px;font-weight:800;color:#111;margin:22px 0 7px;border-bottom:1.5px solid #cbd5e1;padding-bottom:4px;${keepWithNext}">${inline(trimmed.replace(/:$/, ''))}</h3>`;
      } else {
        html += `<p style="font-size:12px;line-height:1.7;color:#1f2937;margin:5px 0;${noSplit}">${inline(line)}</p>`;
      }
    }
  }

  closeList();
  return html;
}

/**
 * Wraps converted body HTML in a complete, print-ready document with a cover
 * header, page margins, and a footer. Use this for any PDF export so every
 * report shares the same clean layout.
 */
export function wrapPrintDocument(params: {
  title: string;
  subtitle?: string;
  date: string;
  bodyHtml: string;
}): string {
  const { title, subtitle, date, bodyHtml } = params;
  const esc = (s: string) =>
    (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1f2937;
         font-size: 12px; line-height: 1.6; -webkit-print-color-adjust: exact; }
  h2, h3, h4 { page-break-after: avoid; }
  p, li, tr { page-break-inside: avoid; }
  .cover { margin-bottom: 18px; border-bottom: 2px solid #0f172a; padding-bottom: 10px; }
  .cover h1 { font-size: 20px; font-weight: 900; margin: 0 0 4px; color: #0f172a; }
  .cover .meta { font-size: 12px; color: #64748b; }
  .footer { text-align: center; font-size: 9px; color: #94a3b8;
            margin-top: 28px; padding-top: 8px; border-top: 1px solid #e5e7eb; }
</style>
</head>
<body>
  <div class="cover">
    <h1>${esc(title)}</h1>
    <div class="meta">${subtitle ? esc(subtitle) + ' &nbsp;·&nbsp; ' : ''}${esc(date)}</div>
  </div>
  ${bodyHtml}
  <div class="footer">Generated by BloomPrint Basketball Intelligence Model &nbsp;·&nbsp; ${esc(date)}</div>
</body>
</html>`;
}

/** Sanitise a string for use as a file system file name. */
export function safeFileName(s: string): string {
  // Only what a file system actually refuses, rather than everything that is
  // not English. Stripping non-ASCII meant a Russian report downloaded as
  // "Report.pdf" and a Chinese one as "vs.pdf" — the coach's own title thrown
  // away because it was not written in Latin letters.
  return (s ?? '')
    .replace(/[/\\:*?"<>|]/g, '')       // illegal in a file name on some OS
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export type ReportSection = { heading: string; body: string; pinned?: boolean };

/**
 * Splits a markdown/plain report into top-level sections.
 * A section starts at a markdown heading (#, ##, ###) OR an ALL-CAPS heading line.
 * Content before the first heading is returned under an "Overview" section.
 * Returns a single "Report" section if no headings are found.
 */
export function splitReportSections(text: string): ReportSection[] {
  const lines = (text ?? '').split('\n');
  const sections: ReportSection[] = [];
  let current: ReportSection | null = null;
  let preamble: string[] = [];

  const headingOf = (line: string): string | null => {
    const t = line.trim();
    if (/^#{1,6}\s+/.test(t)) return t.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').trim();
    // A "LABEL: value" line whose value is a number/grade (e.g. "GRADE: 6.4 / 10")
    // is a sub-field of the section above it, NOT its own toggleable section.
    // The colon must come late enough to be a label: "3-POINT SHOOTING DETAIL:"
    // has a digit but no value after the colon.
    if (/:\s*-?\d/.test(t) && !/:\s*$/.test(t)) return null;
    // An ALL-CAPS line is a heading.
    //
    // This has to be GENEROUS, because a heading it fails to recognise does not
    // simply go unlisted — the section and everything under it is absorbed into
    // the section ABOVE, so switching that one off silently takes this one with
    // it. A coach hid FOCUS AREAS and lost the entire weekly plan.
    //
    // Two shapes it used to miss, both from real programs:
    //   "WEEKLY PLAN — TWO-A-DAYS"   an em dash, absent from the old class
    //   "3-POINT SHOOTING DETAIL"    starts with a digit, and the old rule
    //                                required a letter first
    const CAPS = /^[A-Z0-9][A-Z0-9\s/&()\-—–:'.,%+#]*$/;
    if (
      CAPS.test(t) &&
      /[A-Z]{2}/.test(t) &&        // real words, not "3-2" or a date
      t.length >= 3 && t.length < 70 &&
      !/[.!?]$/.test(t)
    ) {
      return t.replace(/:$/, '').trim();
    }
    return null;
  };

  for (const line of lines) {
    const h = headingOf(line);
    if (h) {
      if (current) sections.push(current);
      else if (preamble.join('').trim()) sections.unshift({ heading: 'Overview', body: preamble.join('\n').trim() });
      current = { heading: h, body: '' };
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);
  if (sections.length === 0) {
    const body = (text ?? '').trim();
    return body ? [{ heading: 'Report', body }] : [];
  }
  // Trim trailing blank lines from each body
  let result = sections.map(s => ({ heading: s.heading, body: s.body.replace(/\n+$/, ''), pinned: false }));

  // Fold a bare group heading into the sections underneath it.
  //
  // A report writes "OFFENSIVE TENDENCIES:" and then "ANGOLA:" and "EGYPT:"
  // beneath it, and does the same again under "DEFENSIVE SCHEME:". Read flat,
  // that is a toggle list containing ANGOLA twice and EGYPT twice, with no way
  // to tell which one is which — and an OFFENSIVE TENDENCIES row that holds no
  // text, so switching it off does nothing at all.
  //
  // A heading with no body of its own, followed by more sections, is a group
  // rather than content. It stops being a row and its name is carried onto its
  // children: "Offensive Tendencies · Angola" — the same separator the report
  // cards use, so one list does not read differently from the other.
  // Where a group ENDS matters as much as where it starts. The run of
  // sub-headings is followed by the next top-level section, and without a rule
  // for that the prefix ran on: "DEFENSIVE SCHEME · SCHEME TENDENCIES — WHAT
  // TO SCOUT AGAINST", a heading that belongs to nobody.
  //
  // A sub-heading is MORE specific than the group above it, so it is shorter —
  // "ANGOLA" under "OFFENSIVE TENDENCIES". A heading longer than its group name
  // is a new section, not a member of one. The second test carries a name that
  // was already a member of an earlier group, which is how these reports repeat
  // the same teams under each heading.
  //
  // A bare heading at the TOP of a document is its title, not a group. A
  // training program opens "BLOOMPRINT PROGRAM UPDATE — BLOOM (6'2 GUARD)" and
  // then every section under it, so treating it as a group stamped that name
  // onto all nine rows — the report's own title, repeated down a list that is
  // already inside that report, pushing the section names off the edge. A group
  // only exists once real content has been seen above it.
  const isBare = (i: number) =>
    !result[i].body.replace(/\s+/g, ' ').trim() && i < result.length - 1;
  const grouped: typeof result = [];
  const seenChildren = new Set<string>();
  let groupName = '';
  let seenBody = false;
  for (let i = 0; i < result.length; i++) {
    if (isBare(i) && !result[i].pinned) {
      if (seenBody) { groupName = result[i].heading; continue; }
      // The title block: kept in the document and always sent, but pinned so it
      // is not offered as a row. Dropping it here would delete the report's
      // own title from what the recipient reads.
      grouped.push({ ...result[i], pinned: true });
      continue;
    }
    if (result[i].body.replace(/\s+/g, ' ').trim().length >= 60) seenBody = true;
    const h = result[i].heading;
    const belongs = !!groupName && !result[i].pinned
      && (h.length < groupName.length || seenChildren.has(h));
    if (!belongs) groupName = '';
    if (belongs) seenChildren.add(h);
    grouped.push(belongs ? { ...result[i], heading: `${groupName} · ${h}` } : result[i]);
  }
  // Only if it actually helped. A document with one bare heading and nothing
  // to attach it to keeps its original shape.
  if (grouped.length) result = grouped;
  // The document header — model banner, report type, opponent and metadata
  // lines — is not toggleable content, so it is pinned and always included.
  //
  // "Header" means the lines BEFORE the first heading, not "every section up
  // to the first long one", which is what this used to say. That test pinned
  // any real section whose body happened to be short: a report opening with a
  // one-line EXECUTIVE SUMMARY lost its switch the moment a later section — a
  // box score, say — was long enough to be judged the first real one. The
  // switches then did not match the report, which is the one thing this list
  // has to get right.
  const firstHeaded = result.findIndex(s => s.heading !== 'Overview' && s.heading !== 'Report');
  for (let i = 0; i < (firstHeaded < 0 ? result.length : firstHeaded); i++) {
    result[i].pinned = true;
  }
  return result;
}

/**
 * Re-assembles only the enabled sections back into a markdown document,
 * preserving heading markers so downstream formatting still applies.
 */
export function joinReportSections(sections: ReportSection[], enabled: Record<string, boolean>): string {
  return sections
    // Pinned header sections are always included, regardless of toggles.
    .filter(s => s.pinned || enabled[s.heading] !== false)
    .map(s => (s.heading === 'Overview' || s.heading === 'Report' ? s.body : `## ${s.heading}\n${s.body}`))
    .join('\n\n')
    .trim();
}
