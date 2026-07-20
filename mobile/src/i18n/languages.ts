// Tier-one language packs shipped with the app. The system supports ANY
// language (a pack is just a data file + a row here); these are the ones
// pre-built and reviewed. `native` is the name shown in pickers — always in
// the language itself so a coach can find their own tongue.
export type AppLanguage = {
  code: string;      // BCP-47 primary tag, matches locales/<code>/*.json
  native: string;    // endonym shown in the picker
  english: string;   // English name (for search/debugging)
  rtl?: boolean;     // right-to-left script (text renders RTL; full mirrored layout is a later pass)
};

export const LANGUAGES: AppLanguage[] = [
  { code: 'en', native: 'English',            english: 'English' },
  { code: 'es', native: 'Español',            english: 'Spanish' },
  { code: 'fr', native: 'Français',           english: 'French' },
  { code: 'de', native: 'Deutsch',            english: 'German' },
  { code: 'it', native: 'Italiano',           english: 'Italian' },
  { code: 'pt', native: 'Português',          english: 'Portuguese' },
  { code: 'nl', native: 'Nederlands',         english: 'Dutch' },
  { code: 'sv', native: 'Svenska',            english: 'Swedish' },
  { code: 'pl', native: 'Polski',             english: 'Polish' },
  { code: 'ro', native: 'Română',             english: 'Romanian' },
  { code: 'el', native: 'Ελληνικά',           english: 'Greek' },
  { code: 'tr', native: 'Türkçe',             english: 'Turkish' },
  { code: 'ru', native: 'Русский',            english: 'Russian' },
  { code: 'uk', native: 'Українська',         english: 'Ukrainian' },
  { code: 'sr', native: 'Srpski',             english: 'Serbian' },
  { code: 'hr', native: 'Hrvatski',           english: 'Croatian' },
  { code: 'lt', native: 'Lietuvių',           english: 'Lithuanian' },
  { code: 'ka', native: 'ქართული',            english: 'Georgian' },
  { code: 'zh', native: '中文',                english: 'Chinese (Simplified)' },
  { code: 'ja', native: '日本語',              english: 'Japanese' },
  { code: 'ko', native: '한국어',              english: 'Korean' },
  { code: 'hi', native: 'हिन्दी',              english: 'Hindi' },
  { code: 'tl', native: 'Tagalog',            english: 'Tagalog (Filipino)' },
  { code: 'ar', native: 'العربية',            english: 'Arabic', rtl: true },
  { code: 'he', native: 'עברית',              english: 'Hebrew', rtl: true },
];

export const LANGUAGE_CODES = LANGUAGES.map(l => l.code);

export const languageName = (code: string): string =>
  LANGUAGES.find(l => l.code === code)?.native ?? code;

/** English name of a language, for AI prompts ("Write the report in Russian"). */
export const languageEnglishName = (code: string): string =>
  LANGUAGES.find(l => l.code === code)?.english ?? code;
