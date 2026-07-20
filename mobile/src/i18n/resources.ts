// Static registry of every shipped language pack. Metro needs static requires,
// so each pack is listed explicitly. A pack missing keys is fine — i18next
// falls back to English per-key.
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import it from './locales/it.json';
import pt from './locales/pt.json';
import nl from './locales/nl.json';
import sv from './locales/sv.json';
import pl from './locales/pl.json';
import ro from './locales/ro.json';
import el from './locales/el.json';
import tr from './locales/tr.json';
import ru from './locales/ru.json';
import uk from './locales/uk.json';
import sr from './locales/sr.json';
import hr from './locales/hr.json';
import lt from './locales/lt.json';
import ka from './locales/ka.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import hi from './locales/hi.json';
import tl from './locales/tl.json';
import ar from './locales/ar.json';
import he from './locales/he.json';

// Every pack lives under the default 'translation' namespace so screens can
// call t('auth.signIn') / t('common.save') with plain dot paths.
const wrap = (pack: Record<string, any>) => ({ translation: pack });

export const resources: Record<string, any> = {
  en: wrap(en), es: wrap(es), fr: wrap(fr), de: wrap(de), it: wrap(it),
  pt: wrap(pt), nl: wrap(nl), sv: wrap(sv), pl: wrap(pl), ro: wrap(ro),
  el: wrap(el), tr: wrap(tr), ru: wrap(ru), uk: wrap(uk), sr: wrap(sr),
  hr: wrap(hr), lt: wrap(lt), ka: wrap(ka), zh: wrap(zh), ja: wrap(ja),
  ko: wrap(ko), hi: wrap(hi), tl: wrap(tl), ar: wrap(ar), he: wrap(he),
};
