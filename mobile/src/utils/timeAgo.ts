// Shared relative-time formatter for player-portal lists ("today", "2 days
// ago", "3 weeks ago", then absolute dates). Coach lists intentionally show
// absolute dates instead.
export const timeAgo = (iso: string): string => {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 7) return `${Math.floor(d)} days ago`;
  if (d < 14) return '1 week ago';
  if (d < 30) return `${Math.floor(d / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString();
};
