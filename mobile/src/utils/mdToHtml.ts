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
  const keepWithNext = 'page-break-after:avoid';

  for (const raw of lines) {
    const line = raw.trimEnd();

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
      // A short line ending with ':' reads as a sub-heading
      const trimmed = line.trim();
      if (trimmed.length < 60 && /:$/.test(trimmed) && !/[.!?]/.test(trimmed.slice(0, -1))) {
        html += `<p style="font-size:13px;font-weight:700;color:#111;margin:12px 0 3px;${keepWithNext}">${inline(trimmed)}</p>`;
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
  return s.replace(/[^a-zA-Z0-9 \-]/g, '').replace(/\s+/g, ' ').trim();
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
    if (/:\s*-?\d/.test(t)) return null;
    // ALL CAPS heading line (no sentence punctuation)
    if (/^[A-Z][A-Z0-9\s/&()\-:'.]{2,}$/.test(t) && t.length < 70 && !/[.!?]$/.test(t)) {
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
  const result = sections.map(s => ({ heading: s.heading, body: s.body.replace(/\n+$/, ''), pinned: false }));
  // The document header (model banner, report type, opponent/metadata lines) is
  // NOT toggleable content — it's the title block. Pin every leading section up
  // to the first one that has a real prose body so it's always included and not
  // shown as a section toggle.
  const firstReal = result.findIndex(s => s.body.replace(/\s+/g, ' ').trim().length >= 60);
  if (firstReal > 0) {
    for (let i = 0; i < firstReal; i++) result[i].pinned = true;
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
