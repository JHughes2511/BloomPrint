// App-wide internationalization. The UI language comes from (in order):
// the coach/player's saved choice → the device language → English.
// Any key missing from a pack falls back to English, so a partial pack is
// always safely usable.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as SecureStore from 'expo-secure-store';
import { getLocales } from 'expo-localization';
import { resources } from './resources';
import { LANGUAGE_CODES } from './languages';

const STORE_KEY = 'app_language';

const deviceLanguage = (): string => {
  try {
    const tags = getLocales().map(l => (l.languageCode ?? '').toLowerCase());
    return tags.find(t => LANGUAGE_CODES.includes(t)) ?? 'en';
  } catch {
    return 'en';
  }
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'en',                 // replaced by initAppLanguage() on boot
  fallbackLng: 'en',
  compatibilityJSON: 'v3',
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

/** Load the saved language (or the device default) at app boot. */
export async function initAppLanguage(): Promise<string> {
  let lang: string | null = null;
  try {
    lang = await SecureStore.getItemAsync(STORE_KEY);
  } catch {}
  const chosen = lang && LANGUAGE_CODES.includes(lang) ? lang : deviceLanguage();
  if (chosen !== i18n.language) await i18n.changeLanguage(chosen);
  return chosen;
}

/** Switch the app language everywhere, instantly, and remember it. */
export async function setAppLanguage(code: string): Promise<void> {
  if (!LANGUAGE_CODES.includes(code)) return;
  await i18n.changeLanguage(code);
  try {
    await SecureStore.setItemAsync(STORE_KEY, code);
  } catch {}
}

export const currentLanguage = (): string => i18n.language || 'en';

export default i18n;
