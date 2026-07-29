# Language pack pipeline

Adding or refreshing a translation without hand-writing 1,800 JSON keys.

```bash
export I18N_WORK=/tmp/i18n            # scratch dir for the transfer files
python3 scripts/i18n/extract.py ka    # -> $I18N_WORK/pack-ka-source.txt
#   ... a translator (human or model) writes $I18N_WORK/pack-ka-out.txt
#       in the same `<number><TAB><text>` format, same order
python3 scripts/i18n/assemble.py ka   # -> mobile/src/i18n/locales/ka.json
python3 scripts/i18n/validate.py ka   # parity / placeholders / types / empties
```

Why this shape:

- **Only values move.** The translator never sees or writes the key structure,
  so the transfer is ~40% smaller than shipping nested JSON both ways.
- **Key parity is structural.** `assemble.py` rebuilds from `en.json`, so a pack
  cannot end up with missing or extra keys; any line the translator skipped
  falls back to English and is reported.
- **Paths are tuples, not dotted strings.** Some keys legitimately contain dots
  (`teamGrade.stats."Off. Reb"`), which naive path-splitting corrupts.
- **Validation is separate.** The translator doesn't burn turns self-checking;
  `validate.py` does it deterministically here.

Run `validate.py` with no arguments to check every pack at once.
