# Phase 14 Flow-Line Mode Matrix

Evidence source: `tests/ui/theme-token-coverage.spec.js`  
Case: `flow-line single and multi mode apply distinct runtime vars`

| Mode | Input Payload | Expected Runtime Vars | Evidence |
| --- | --- | --- | --- |
| single | `single.mainColor=#4fc1ff`, `multi.mainColor=#4fc1ff`, steps `16/-4/5` | `--flow-line-mode=single`, `--flow-line-main=#4fc1ff`, `--flow-line-depth-hue-step=16`, `--flow-line-depth-saturation-step=-4`, `--flow-line-depth-lightness-step=5` | Playwright assertion passed |
| multi | `single.mainColor=#4fc1ff`, `multi.mainColor=#ff8844`, steps `22/-2/6` | `--flow-line-mode=multi`, `--flow-line-main=#ff8844`, `--flow-line-depth-hue-step=22`, `--flow-line-depth-saturation-step=-2`, `--flow-line-depth-lightness-step=6` | Playwright assertion passed |

## TOKN Mapping

- TOKN-04: single/multi mode toggle is observable via `--flow-line-mode`.
- TOKN-05: mode-specific color/step config is reflected in runtime CSS variables used by flow rendering.
