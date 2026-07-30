import type { TFunction } from 'i18next';

/**
 * Render a server-created notification in the reader's language.
 *
 * A notification is stored once, in whatever language the sender happened to be
 * using, so the row can't carry finished prose — it carries `i18n_key` (a
 * "notifs.<name>" base with `.title` and `.body` underneath) plus the params to
 * interpolate. A Spanish coach and an English player on the same team each read
 * the same row in their own language.
 *
 * `title`/`body` on the row stay as the English fallback: rows written before a
 * sender was migrated have no key, and a key that no longer exists in the packs
 * still renders as readable English rather than as a raw key name.
 */

/** Params whose value is an API enum the client, not the server, must localize. */
const ENUM_PARAMS: Record<string, string> = {
  // e.g. "scouting_report" -> the coach's word for a scouting report
  type: 'reportTypes',
};

function localizeParams(params: Record<string, any> | null | undefined, tr: TFunction) {
  if (!params) return {};
  const out: Record<string, any> = { ...params };
  for (const [name, ns] of Object.entries(ENUM_PARAMS)) {
    const raw = out[name];
    if (typeof raw === 'string' && raw) {
      // Fall back to the de-underscored enum value so an output_type the packs
      // don't know about still reads as words rather than "film_breakdown".
      out[name] = tr(`${ns}.${raw}`, { defaultValue: raw.replace(/_/g, ' ') });
    }
  }
  return out;
}

export function notificationTitle(n: any, tr: TFunction): string {
  if (!n?.i18n_key) return n?.title ?? '';
  return tr(`${n.i18n_key}.title`, {
    ...localizeParams(n.i18n_params, tr),
    defaultValue: n.title ?? '',
  });
}

export function notificationBody(n: any, tr: TFunction): string {
  if (!n?.i18n_key) return n?.body ?? '';
  return tr(`${n.i18n_key}.body`, {
    ...localizeParams(n.i18n_params, tr),
    defaultValue: n.body ?? '',
  });
}
