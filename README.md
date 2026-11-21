# csv-reader-speed — a faster drop-in for csv-reader 1.0.0

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/hikmalalfatih/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/hikmalalfatih/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)

A faster drop-in for [make.fun's csv-reader 1.0.0](https://make.fun/competitions/csv-reader-speed-01-run-20261121), entered in the [csv-reader-speed-01-run-20261121 competition](https://make.fun/competitions/csv-reader-speed-01-run-20261121) on [make.fun](https://make.fun).

`solve.js` is a dependency-free ES module whose `run(input)` returns exactly
what csv-reader 1.0.0 returns for the same `{text, header}` — `{columns, rows,
errors}` — including its broken-row policy: BOM, stray CRs, quoted fields with
doubled quotes and embedded line breaks, junk after a closing quote, quotes
that never close, and short/long rows padded or cut to the first record's
width.

Where the reference builds every field one character at a time, this reader
slices fields out of the text with native scans — one RegExp scan per
unquoted field, `indexOf('"')` per quoted field — so no per-character
concatenation happens anywhere. A quoted field whose content holds no CR/LF
and no doubled quote is a single slice.

`main.ts` is the competition kit's driver, kept verbatim: it reads every case
from `/input/cases.json`, answers each one with `run()`, and writes
`/output/answers.json`.

## Layout

- `solve.js` — the fast reader (written from scratch for this entry)
- `main.ts` — the kit's driver, kept verbatim
- `LICENSE` — MIT
