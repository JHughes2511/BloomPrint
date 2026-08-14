import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { api } from '../api/client';
import { mdToHtml, wrapPrintDocument, safeFileName } from './mdToHtml';

/**
 * Exporting and printing a report, on every platform the app runs on.
 *
 * WHAT WAS WRONG
 *
 * Both went through expo-print, which is a stub on web: printToFileAsync
 * returns undefined there — the source of "Cannot destructure property 'uri'"
 * — and printAsync is a bare window.print(), which prints whatever is on
 * screen. So on the web, on the iPad and on a phone browser, Export produced
 * an error and Print produced a screenshot of the app with the export sheet
 * open over it. Native was fine, which is why it survived this long.
 *
 * WHAT HAPPENS NOW
 *
 * The PDF is built by the server and downloaded, so there is one renderer for
 * every platform and the file is a real file rather than a print dialog the
 * coach has to drive. Printing renders the report into a document of its own
 * and prints THAT, so what comes out is the report and not the screen.
 *
 * Both take the report's text, not HTML. The text is what the coach filtered
 * with the section switches, so what comes out is what they ticked.
 */

const dateLabel = () =>
  new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export type ReportDoc = {
  title: string;
  subtitle?: string;
  /** The report itself, as markdown or plain text. */
  text: string;
};

/** The same print-ready document for every screen, so exports match prints. */
export function reportHtml({ title, subtitle, text }: ReportDoc): string {
  return wrapPrintDocument({
    title,
    subtitle: subtitle ?? '',
    date: dateLabel(),
    bodyHtml: mdToHtml(text ?? ''),
  });
}

// ── PDF ─────────────────────────────────────────────────────────────────────

function saveBlobWeb(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Revoked on a delay, not immediately: Safari reads the object URL after the
  // click returns, and revoking synchronously gives an empty download.
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;   // one apply() per 32k, or a long report blows the stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
  }
  return typeof btoa === 'function' ? btoa(bin) : global.Buffer.from(bin, 'binary').toString('base64');
}

/**
 * Build the PDF on the server from a print document, and hand it to the coach.
 *
 * The HTML is the same one the screen would have printed, so the file and the
 * printed page are the same document.
 *
 * Web downloads it. Native writes it to the cache and opens the share sheet,
 * which is where a file goes on a phone.
 */
export async function exportHtmlPdf(html: string, title: string): Promise<void> {
  if (!(html ?? '').trim()) throw new Error('There is nothing to export.');
  const filename = `${safeFileName(title || 'Report') || 'Report'}.pdf`;

  if (Platform.OS === 'web') {
    const res = await api.post('/exports/pdf', { title, html }, { responseType: 'blob' });
    saveBlobWeb(res.data as Blob, filename);
    return;
  }

  const res = await api.post('/exports/pdf', { title, html }, { responseType: 'arraybuffer' });
  const dest = (FileSystem.cacheDirectory ?? '') + filename;
  await FileSystem.writeAsStringAsync(dest, bytesToBase64(new Uint8Array(res.data)), {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: title });
  }
}

/** A report, exported. Builds the standard print document, then exports it. */
export async function exportReportPdf(doc: ReportDoc): Promise<void> {
  if (!(doc.text ?? '').trim()) throw new Error('There is nothing to export.');
  await exportHtmlPdf(reportHtml(doc), doc.title);
}

// ── Print ───────────────────────────────────────────────────────────────────

/**
 * Print a document of our own making, rather than the page the coach is on.
 *
 * A new window first, because that is what iOS Safari prints reliably — an
 * iframe there has a habit of printing the parent page instead, which is the
 * bug this function exists to fix. The window is opened from the coach's tap,
 * so a popup blocker allows it; when one refuses anyway, the iframe is a
 * workable second choice on every other browser.
 */
function printHtmlWeb(html: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let win: Window | null = null;
    try { win = window.open('', '_blank'); } catch { win = null; }

    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      const go = () => {
        try { win!.focus(); win!.print(); resolve(); }
        catch (e) { reject(e as Error); }
      };
      // Give the document a moment to lay out; printing an empty page is the
      // failure this guards against.
      if (win.document.readyState === 'complete') setTimeout(go, 120);
      else win.onload = () => setTimeout(go, 120);
      return;
    }

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;';
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      } catch (e) {
        reject(e as Error);
      } finally {
        setTimeout(() => frame.remove(), 2000);
      }
    };
    // srcdoc rather than document.write: onload then fires after the content
    // is in, so print() cannot run against an empty frame.
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

export async function printReport(doc: ReportDoc): Promise<void> {
  const html = reportHtml(doc);
  if (Platform.OS === 'web') return printHtmlWeb(html);
  await Print.printAsync({ html });
}

/** For the few screens that build their own document rather than a report. */
export async function printRawHtml(html: string): Promise<void> {
  if (Platform.OS === 'web') return printHtmlWeb(html);
  await Print.printAsync({ html });
}
