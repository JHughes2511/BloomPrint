/**
 * Converts a markdown string to HTML suitable for expo-print PDFs.
 * Handles: # h1-h3, **bold**, *italic*, - / * bullet lists, 1. numbered lists.
 */
export function mdToHtml(md: string): string {
  const lines = md.split('\n');
  let html = '';
  let listType: 'ul' | 'ol' | null = null;

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inline = (s: string) =>
    escape(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>');

  const closeList = () => {
    if (listType === 'ul') { html += '</ul>'; }
    if (listType === 'ol') { html += '</ol>'; }
    listType = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^### /.test(line)) {
      closeList();
      html += `<h4 style="font-size:13px;font-weight:700;color:#333;margin:14px 0 4px">${inline(line.slice(4))}</h4>`;
    } else if (/^## /.test(line)) {
      closeList();
      html += `<h3 style="font-size:14px;font-weight:700;color:#222;margin:20px 0 6px;border-bottom:1px solid #ddd;padding-bottom:3px">${inline(line.slice(3))}</h3>`;
    } else if (/^# /.test(line)) {
      closeList();
      html += `<h2 style="font-size:16px;font-weight:800;color:#111;margin:24px 0 8px">${inline(line.slice(2))}</h2>`;
    } else if (/^[-*•] /.test(line)) {
      if (listType !== 'ul') { closeList(); html += '<ul style="margin:6px 0;padding-left:20px">'; listType = 'ul'; }
      html += `<li style="font-size:12px;line-height:1.7;margin:2px 0">${inline(line.replace(/^[-*•] /, ''))}</li>`;
    } else if (/^\d+\. /.test(line)) {
      if (listType !== 'ol') { closeList(); html += '<ol style="margin:6px 0;padding-left:20px">'; listType = 'ol'; }
      html += `<li style="font-size:12px;line-height:1.7;margin:2px 0">${inline(line.replace(/^\d+\. /, ''))}</li>`;
    } else if (line.trim() === '') {
      closeList();
      html += '<br/>';
    } else {
      closeList();
      html += `<p style="font-size:12px;line-height:1.7;color:#444;margin:4px 0">${inline(line)}</p>`;
    }
  }

  closeList();
  return html;
}

/** Sanitise a string for use as a file system file name. */
export function safeFileName(s: string): string {
  return s.replace(/[^a-zA-Z0-9 \-]/g, '').replace(/\s+/g, ' ').trim();
}
