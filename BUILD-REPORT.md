# BUILD-REPORT — csv-reader-speed-01-run-20261121

Entry built 21 Nov 2026 in a recorded agent session, from the kit at
`~/workspace/makefun/csv-reader-kit/csv-reader-speed-01-run-20261121-kit/`.
Repo: `~/workspace/makefun/csv-reader-entry/` — 4 files, 14.253 bytes total
(≤ 1 MiB cap).

## Files and provenance

- `solve.js` — the fast reader, written FRESH in this session (tool tulis, no
  copying from any older entry). Dependency-free ES module, `run(input)` →
  `{columns, rows, errors}` exactly as csv-reader 1.0.0.
- `main.ts` — the kit's driver, copied VERBATIM from
  `baselines/csv-reader/main.ts` (sha256
  `884b8b2ffb9c1c309e0bcc455c8c832a5f1fd02ef79a4a008bc61993466a52fd`,
  matches kit.json). The kit says explicitly: "An entry keeps this driver".
- `LICENSE` — standard MIT text, copyright hikmalalfatih 2026.
- `README.md` — follows the make.fun readme template: the three live
  make.fun badges (competition, rank, reward) for owner `hikmalalfatih` /
  repo `csv-reader-speed-01-run-20261121`, links to the make.fun competition
  page, no `{owner}` placeholder left.

## Parser approach

The reference builds every field one character at a time. This reader slices
fields out of the text with native scans instead, so no per-character
concatenation happens anywhere:

- Unquoted field: two `indexOf` scans (next `,` and next `\n`); the nearer
  one ends the field, one `slice()` takes its value. A `\r` inside the slice
  is rare, so it is checked on the short slice and only then handled on a
  slow path: a CR immediately before the terminating LF is the record's CRLF
  break, any other CR is a dropped `stray_cr`.
- Quoted field: `indexOf('"')` finds the closing quote (or a doubled `""`,
  which contributes one quote and continues). Content with no CR/LF and no
  doubled quote is a single slice; only stretches with CR/LF get normalised
  (CRLF / lone CR → LF, line breaks counted) and only doubled-quote fields
  build a parts array. Line breaks inside quotes are counted but only applied
  once the quote is confirmed closed — on an unterminated quote the count is
  discarded, the line resets to the opening line, and the text is re-read as
  unquoted starting with a literal `"` (exactly the reference's behaviour).
- Junk after a closing quote is read as unquoted appended to the quoted value;
  `quote_junk` fires only when junk kept ≥ 1 character, after any `stray_cr`
  errors from the junk read (same error order as the reference).
- Records: blank lines skipped, one-field empty unquoted record (a line of
  only stray CRs) is no record, first record sets the width, header stored
  as-is, later records padded (`short_row`, with `fields`) or cut (`long_row`,
  with `extra`). Every error carries the record's start line and its index in
  `rows` (null for the header).

## Correctness

- Practice set, all 6 cases (`g-0001`–`g-0006`): output byte-identical to
  `practice/reference/expected.json` (JSON.stringify comparison).
- Fuzz: 20.000 random inputs built from CSV-hostile pieces (quotes, doubled
  quotes, CR, LF, CRLF, BOM, non-ASCII, unterminated quotes, junk) × random
  header true/false — all identical to live `readCsv` from the kit's vendor
  copy. Plus 92 targeted edge cases (empty text, BOM-only, lone CRs, `"""`,
  quoted CR/LF, junk variants) — all identical.
- Bug found and fixed during testing: the first version never advanced `pos`
  when an unquoted field ran to end-of-text with no terminator, so a text
  whose last line break was stripped (case `g-0006`) looped forever creating
  identical records (OOM). Fixed by setting `pos = len` on that path; `g-0006`
  then matched byte-identically.

## Benchmark (run() only, 6 practice cases, 10,2 MB total, node --no-incremental-marking)

| run | baseline csv-reader 1.0.0 | this solve.js | speedup |
| --- | --- | --- | --- |
| v1 (RegExp per field) | median 489,5 ms | median 136,1 ms | 3,60x |
| v2 final (indexOf per field) | median 504,3 ms | median 96,5 ms | 5,22x |
| v2 final, repeat | median 603,9 ms | median 96,4 ms | 6,26x |

Baseline median varies run to run (~490–604 ms); this entry is stable at
~96 ms. Speedup ≈ 5–6x on the practice set.

## grade-local (kit's own grader, --driver process — docker is not installed on this VM)

```
node cli/makefun.mjs grade-local --kit . --bot /home/hatch/workspace/makefun/csv-reader-entry --driver process
kit csv-reader-speed-01-run-20261121 dev: verified 31 files
scores    {"cases_passed":6,"cases_total":6,"passed":1}
checks    6 of 6 points over 1 check
L1 regrade        reproduced byte for byte
result_sha256     07e6598c67f90187f552b0f9e20ec03689b8e3f267a739adb7c1f6b6b84ac546
```

Notes: the result_sha256 cannot equal the server's (this VM runs node
v24.22.1, the server harness v26.13.1; process driver is unisolated). The
score records `authored 0.000000000` because no transcripts were attached in
this local run — transcripts are optional for this competition
(`transcripts_required: false`).

## bundle --dry-run (session check only, nothing written)

- This session IS detected as a recorded Muse app session:
  `sessions/muse-app/15d7a37b-86d0-4f70-8651-7ceef036a5a4.jsonl`,
  37 turns, 125 lines kept; system prompt found at
  `~/workspace/system/system_prompt.md`.
- Dry-run against the real entry dir was blocked by "not inside a git
  repository" (no repo exists yet — the parent creates it). Re-run against a
  throwaway git copy in /tmp confirmed the session is found and listed.
- For the FINAL bundle the parent (top-level agent, agent_id
  318cb0e8-868d-437d-8ca4-161b161955bc) must run bundle itself: this is a
  subagent session, so its usage rows are written only once the run completes
  and the parent session must be included (bundle's own warning). Missing
  flags for the final bundle: `--prompt-file` + `--prompt-origin` (the
  person's opening words), `--provider` + `--effort`, `--mcp none`,
  `--instructions` / `--context` for AGENTS.md etc.

## Remaining weaknesses + iteration triggers

- Speed: ~96 ms is dominated by per-field `indexOf` + `slice` and by the
  rows/fields array allocations (~720k fields over 6 cases). Next iteration
  candidates, in order: (1) a record-level fast path — a whole line with no
  `"` and no stray CR becomes one `split(',')` (helps most on LF files with
  few quoted fields); (2) avoid the `{value, ended, added}` object per field
  (return value + encode `ended` separately); (3) skip `String(input.text)`
  when the input is already a string. Any of these must re-pass the fuzz +
  practice suite before replacing this version.
- Correctness risk is concentrated in inputs the practice set never draws:
  a scored set drawn fresh after entries close could contain a broken-row
  shape the fuzzer's piece list never produced. The fuzz coverage (20k random
  + 92 edges) is the main mitigation; a second fuzz round with longer pieces
  and multi-record texts would raise confidence further.
- `grade-local` here ran on node v24.22.1 under the process driver; the
  server grades in docker on node v26.13.1. Behaviour should be identical
  (pure string code, no version-specific APIs), but the first server-side
  grade is the real confirmation.
- Repo NOT created, NOT submitted by this build: the parent creates repo
  `hikmalalfatih/csv-reader-speed-01-run-20261121`, runs the final bundle from
  the top-level agent, then submits (submission #1 = measurement tool; ≥2
  quota must remain for iteration; competition quota baseline 19/20 total
  used across the account — this entry would be the next submission).
