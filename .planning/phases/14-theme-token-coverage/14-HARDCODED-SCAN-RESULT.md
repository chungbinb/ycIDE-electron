# Phase 14 Hardcoded Color Scan Result

## Command

```bash
node scripts/theme/scan-hardcoded-colors.mjs --phase=14 --strict
```

## Result Snapshot

- status: `pass`
- strict: `true`
- scannedFiles: `6`
- unresolved violations: `0`
- unresolved hits: `0`
- resolved fallback files: `1`
- resolved fallback hits: `167`

## Triage Rule Used

- Literal colors found as CSS fallback values inside `var(...)` are classified as `resolved-fallback`.
- Strict gate fails only for `unresolved` hits.

## File Summary

| File | Unresolved Hits | Resolved Fallback Hits |
| --- | ---: | ---: |
| `src/renderer/src/components/Editor/EycTableEditor.tsx` | 0 | 0 |
| `src/renderer/src/components/Editor/EycTableEditor.css` | 0 | 167 |
| `src/renderer/src/components/Editor/VisualDesigner.tsx` | 0 | 0 |
| `src/renderer/src/components/Editor/VisualDesigner.css` | 0 | 0 |
| `src/renderer/src/components/Icon/Icon.tsx` | 0 | 0 |
| `src/renderer/src/components/Icon/Icon.css` | 0 | 0 |

## TOKN-06 Closeout

Visible-surface unresolved hardcoded-color residue is **zero**; TOKN-06 gate condition is satisfied.
