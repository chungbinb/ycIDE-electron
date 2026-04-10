# Phase 13 Contrast Log (WCAG AA)

## Method

- Command: `node scripts/theme/contrast-check.mjs`
- Inputs: `themes/默认深色.json`, `themes/默认浅色.json`
- Formula: WCAG relative luminance contrast ratio.
- Thresholds:
  - **4.5:1** for normal text readability
  - **3:1** for focus/indicator visibility

## Results

| Theme | Check | Ratio | Threshold | Result |
|---|---|---:|---:|---|
| dark | body-text | 10.38 | 4.5 | PASS |
| dark | secondary-text | 5.64 | 4.5 | PASS |
| dark | titlebar-text | 7.98 | 4.5 | PASS |
| dark | statusbar-text | 4.51 | 4.5 | PASS |
| dark | focus-indicator | 3.96 | 3.0 | PASS |
| light | body-text | 14.49 | 4.5 | PASS |
| light | secondary-text | 5.86 | 4.5 | PASS |
| light | titlebar-text | 14.84 | 4.5 | PASS |
| light | statusbar-text | 12.95 | 4.5 | PASS |
| light | button-secondary-text | 14.84 | 4.5 | PASS |
| light | warning-surface-text | 6.58 | 4.5 | PASS |
| light | hover-readable | 14.18 | 4.5 | PASS |
| light | active-readable | 12.79 | 4.5 | PASS |
| light | focus-indicator | 4.76 | 3.0 | PASS |

## Requirement Trace

- **THME-03:** Quantitative readability proof for core and interaction-state token pairs.
- **Regression guard:** dark ratios remained above thresholds while adding light-mode coverage.
