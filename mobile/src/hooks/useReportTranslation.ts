import { useCallback, useEffect, useRef, useState } from 'react';
import { translationsAPI } from '../api/client';
import { currentLanguage } from '../i18n';

/**
 * Show a stored report in the reader's language.
 *
 * Reports keep the language they were generated in — that text is the source of
 * truth. When the reader's language differs we fetch a cached translation and
 * show that by default, with a toggle back to the original. Any failure falls
 * back to the original rather than blocking the read.
 */
export function useReportTranslation(
  reportType: string | undefined,
  reportId: number | undefined,
  originalText: string | undefined,
) {
  const lang = currentLanguage();
  // Only offer translation when the UI isn't English: an English-reading coach
  // never needs it, and the report's own language isn't reliably detectable.
  const eligible = !!reportType && !!reportId && !!originalText?.trim() && lang !== 'en';

  const [translated, setTranslated] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!eligible) { setTranslated(null); setFailed(false); return; }
    const seq = ++reqRef.current;   // ignore responses from superseded requests
    setLoading(true);
    setFailed(false);
    translationsAPI.report(reportType!, reportId!, lang)
      .then(res => { if (seq === reqRef.current) setTranslated(res.text); })
      .catch(() => { if (seq === reqRef.current) setFailed(true); })
      .finally(() => { if (seq === reqRef.current) setLoading(false); });
  }, [eligible, reportType, reportId, lang, originalText]);

  const toggle = useCallback(() => setShowOriginal(v => !v), []);

  return {
    /** What to render. */
    text: !eligible || failed || showOriginal || !translated ? (originalText ?? '') : translated,
    /** True when the visible text is a translation. */
    isTranslated: eligible && !failed && !showOriginal && !!translated,
    /** Whether the toggle should be offered at all. */
    canToggle: eligible && !failed && !!translated,
    showOriginal,
    loading,
    failed,
    toggle,
    language: lang,
  };
}
