// Helpers for report output types, which may be a single key (e.g.
// "coaching_report") or a comma-separated combination
// (e.g. "coaching_report,scouting_report") that produces one comprehensive report.

const titleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function parseOutputTypes(outputType?: string | null): string[] {
  return (outputType ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

/** Display title: a single type's name, or "Comprehensive Report" for a combo. */
export function outputTypeLabel(outputType?: string | null): string {
  const types = parseOutputTypes(outputType);
  if (types.length === 0) return 'Report';
  if (types.length > 1) return 'Comprehensive Report';
  return titleCase(types[0]);
}

/** Subtitle for a combo: "Coaching Report + Scouting Report"; empty for a single. */
export function outputTypeSubtitle(outputType?: string | null): string {
  const types = parseOutputTypes(outputType);
  if (types.length <= 1) return '';
  return types.map(titleCase).join(' + ');
}

export function isComboReport(outputType?: string | null): boolean {
  return parseOutputTypes(outputType).length > 1;
}
