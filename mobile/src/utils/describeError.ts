/**
 * A server error as a sentence, not as "[object Object]" — and never as a crash.
 *
 * FastAPI answers a validation failure with a LIST of objects under `detail`.
 * Interpolating that into a string produced "[object Object]", which told a
 * coach something broke while hiding the one fact that would explain it — and
 * handing it straight to a <Text> is worse than that: React refuses to render
 * an object child and takes the whole screen down with it. That is exactly how
 * a failed roster import turned into a blank page.
 *
 * Every alert that shows a server message should go through here.
 */
export function describeError(e: any, fallback = 'Something went wrong'): string {
  const detail = e?.response?.data?.detail;

  if (typeof detail === 'string' && detail) return detail;

  if (Array.isArray(detail)) {
    const parts = detail
      .map((d: any) => {
        // "body.file" says more than "file" alone when several fields fail.
        const where = Array.isArray(d?.loc) ? d.loc.filter((x: any) => x !== 'body').join('.') : '';
        return [where, d?.msg].filter(Boolean).join(': ');
      })
      .filter(Boolean);
    if (parts.length) return parts.join('\n');
  }

  if (detail && typeof detail === 'object') {
    try { return JSON.stringify(detail); } catch { /* fall through */ }
  }

  const status = e?.response?.status;
  return e?.message || (status ? `Request failed (${status})` : fallback);
}
