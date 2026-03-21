# Encoding Conversion Fixture Matrix

This fixture set validates `scripts/migration/convert-encoding.mjs` against ENCD-01..ENCD-04.

## Libraries

- `lib-alpha` (unmigrated) — primary fixture library used by tests.

## File Cases

- `gbk-source.txt` — GBK encoded content, must convert to canonical UTF-8.
- `utf8-bom.txt` — UTF-8 with BOM, must be rewritten to canonical UTF-8 without BOM.
- `notes-noext` — extensionless text file, included by text-safety detection.
- `mixed-risk.txt` — invalid/mixed bytes, must be blocked with reason `mixed_or_uncertain`.
- `mojibake.txt` — high-risk mojibake markers, must be blocked with reason `high_risk_mojibake`.
- `binary.dat` — binary payload, must be skipped and never rewritten.

## Deterministic Sampling

- Fixed sample size: **N=5** files per library report.
- Sampling source is deterministic path ordering.
- If fewer than 5 scanned files exist, sample all scanned files.

## Expected Outcomes

- ENCD-01: repeated runs produce byte-identical outputs/reports.
- ENCD-02: mixed/high-risk files are blocked and unchanged.
- ENCD-03: reports include `total/scanned/converted/skipped/blocked`, blocked reasons, deterministic sample list.
- ENCD-04: converted outputs preserve line count/token invariants and contain no replacement char `�`.
