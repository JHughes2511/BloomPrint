import { mdToHtml, wrapPrintDocument } from './mdToHtml';

/**
 * Builds a well-formatted, print-ready HTML document for PDF export via expo-print.
 *
 * - Markdown is converted (not just stripped): **bold** renders bold, ## headings
 *   render as larger, bold, underlined section headers — and NO raw markdown
 *   symbols (##, **, etc.) leak into the output.
 * - Plain ALL-CAPS lines are also promoted to headings (legacy report style).
 * - Nothing is cut off across page breaks: paragraphs/list items never split and
 *   headings are never stranded at the bottom of a page.
 */
export function buildReportHtml(params: {
  title: string;       // e.g. "Training Program"
  subject: string;     // e.g. player name or team name
  date: string;        // formatted date string
  body: string;        // raw report text (markdown or plain)
}): string {
  const { title, subject, date, body } = params;

  // Promote legacy ALL-CAPS heading lines to markdown ## so they format as headings.
  const normalized = (body ?? '')
    .split('\n')
    .map(line => {
      const t = line.trim();
      const isAllCapsHeader =
        /^[A-Z][A-Z0-9\s/&()\-:'.]{2,}$/.test(t) && t.length < 70 && !/^#{1,6}\s/.test(t);
      return isAllCapsHeader ? `## ${t}` : line;
    })
    .join('\n');

  const bodyHtml = mdToHtml(normalized);
  return wrapPrintDocument({ title, subtitle: subject, date, bodyHtml });
}

/** Returns a well-formatted file name: "ReportType - Subject - YYYY-MM-DD" */
export function buildPdfFileName(reportType: string, subject: string, date?: Date): string {
  const d = date ?? new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // See safeFileName: a name is sanitised, not transliterated.
  const safe = (s: string) => (s ?? '')
    .replace(/[/\\:*?"<>|]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${safe(reportType)} - ${safe(subject)} - ${dateStr}`;
}
