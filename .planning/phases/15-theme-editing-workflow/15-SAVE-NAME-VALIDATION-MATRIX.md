# Phase 15 Save Name Validation Matrix

Evidence sources:
- UI: `tests/ui/theme-editing-workflow.spec.js` case `FLOW-03 + D15-09/D15-10/D15-11/D15-12...`
- Contract: `tests/contract/theme-draft-workflow.spec.mjs` case `FLOW-03 + D15-09/D15-10/D15-11/D15-12...`

## Matrix

| Case | Input | Expected | Evidence |
| --- | --- | --- | --- |
| Empty name | `''` | Reject with “不能为空” | UI assertion pass |
| Too long | `33 chars` | Reject with “不能超过32” | UI assertion pass |
| Reserved chars | `非法:名称` | Reject with “非法字符” | UI assertion pass |
| Duplicate name | `默认深色` | Reject with “已存在” | UI assertion pass |
| Trim normalization | `  自动主题-<ts>  ` | Saved as trimmed id | UI checks radio name/effectiveThemeId use trimmed name |
| Successful create/activate | valid unique name | New theme appears and is active | UI assertions (`aria-checked=true`, `effectiveThemeId`) |

## Contract-level Guardrails

`validateCustomThemeName` contract assertions verify:

- trim normalization: `(rawName || '').trim()`
- max length gate: `normalizedName.length > CUSTOM_THEME_NAME_MAX_LENGTH`
- reserved character gate: `CUSTOM_THEME_NAME_RESERVED_CHARS`
- IPC wiring: preload/main/renderer/dialog all call `theme:saveAsCustom`

## D15 Mapping

- D15-09: manual name input required.
- D15-10: duplicate names blocked.
- D15-11: successful save activates custom theme immediately.
- D15-12: trim + length + reserved-char validation enforced.
