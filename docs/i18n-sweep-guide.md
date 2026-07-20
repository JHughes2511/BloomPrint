# i18n Extraction Guide (BloomPrint sweep)

Pattern for converting a screen/component to translations. Follow EXACTLY.

## Setup in each file
1. `import { useTranslation } from 'react-i18next';`
2. Inside the component: `const { t: tr } = useTranslation();`
   - The theme hook already uses `t` (`const { t } = useTheme()`). NEVER touch that. Always name the translation function `tr`.
   - For helper components in the same file that render text, give them their own `useTranslation()` hook call.
   - For code OUTSIDE components (module-level helpers that build display strings), use `import i18n from '../i18n';` (adjust relative path) and `i18n.t('ns.key')` — but prefer moving the string lookup into the component when easy.

## What to translate
- Every USER-VISIBLE string: `<Text>` content, `placeholder=`, `Alert.alert(title, message)` and its button `text:` labels, modal titles, button labels, empty-state text, toasts, section headers, hint/desc text.
- Template strings with variables become interpolations: `` `Step ${a} of ${b}` `` → `tr('ns.step', { current: a, total: b })` with catalog value `"Step {{current}} of {{total}}"`.

## What NOT to touch
- API values: output_type keys, mode keys, stat keys, navigation route names, params, ids — anything sent to or compared against the backend.
- Data that comes FROM the backend (report text, names, opponent names).
- console/log strings, style objects, testIDs.
- "BloomPrint" brand name (keep inside translated sentences as-is).

## Keys
- Namespace per screen, camelCase: e.g. `roster.addPlayer`, `evalReport.exportPdf`.
- Shared vocabulary goes in `common.*` — REUSE the existing keys from `mobile/src/i18n/locales/en.json` (`common.save`, `common.cancel`, `common.delete`, `common.close`, `common.back`, `common.search`, `common.share`, `common.send`, `common.print`, `common.export`, `common.generate`, `common.error`, `common.somethingWentWrong`, `common.loading`, `common.done`, `common.ok`). Do NOT re-create these per-screen.
- Key names describe MEANING not position: `deleteConfirmTitle`, not `alert1`.

## Output: fragment file (do NOT edit en.json)
Write ALL new keys for your batch to ONE file:
`mobile/src/i18n/locales/_fragments/<batch-name>.json`
Shape: `{ "<namespace>": { "key": "English value", ... }, ... }` (nested allowed).
Only NEW keys — nothing that already exists in en.json.

## Validation (must pass before you finish)
```
cd /home/user/BloomPrint/mobile && npx esbuild <each file you edited> --loader:.tsx=tsx --bundle=false --outdir=/dev/null
python3 -c "import json; json.load(open('src/i18n/locales/_fragments/<batch-name>.json'))"
```
Also grep your edited files for leftover hardcoded strings in Text/placeholder/Alert to confirm coverage, and confirm you did NOT modify any file outside your batch.
