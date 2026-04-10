# Phase 13 Theme Readability Coverage Checklist

## Scope

App-owned visible surfaces introduced/adjusted in Plan 13-03, audited for light-mode readability and interaction-state clarity.

## Surface Coverage Matrix (THME-03)

| Surface | Default | Hover | Active | Disabled | Focus | Evidence |
|---|---|---|---|---|---|---|
| Title bar menus/dropdowns | ✅ | ✅ | ✅ | ✅ | ✅ | `src/renderer/src/components/TitleBar/TitleBar.css`, `tests/ui/theme-baseline.spec.js` |
| Toolbar buttons | ✅ | ✅ | ✅ | ✅ | ✅ | `src/renderer/src/components/Toolbar/Toolbar.css` |
| Sidebar/project tree | ✅ | ✅ | ✅ | ✅ | ✅ | `src/renderer/src/components/Sidebar/Sidebar.css` |
| Editor tabs + editor shell | ✅ | ✅ | ✅ | ✅ | ✅ | `src/renderer/src/components/Editor/Editor.css` |
| Output panel/messages | ✅ | ✅ | ✅ | ✅ | ✅ | `src/renderer/src/components/OutputPanel/OutputPanel.css` |
| Status bar/items | ✅ | ✅ | ✅ | ✅ | ✅ | `src/renderer/src/components/StatusBar/StatusBar.css` |
| Library dialog | ✅ | ✅ | ✅ | ✅ | ✅ | `src/renderer/src/components/LibraryDialog/LibraryDialog.css` |
| New Project dialog | ✅ | ✅ | ✅ | ✅ | ✅ | `src/renderer/src/components/NewProjectDialog/NewProjectDialog.css` |
| Theme settings dialog | ✅ | ✅ | ✅ | ✅ | ✅ | `src/renderer/src/components/ThemeSettingsDialog/ThemeSettingsDialog.css`, `tests/ui/theme-baseline.spec.js` |

## Requirement Trace

- **THME-01 (switch correctness):** `tests/ui/theme-baseline.spec.js` case “switches built-in themes from title bar entry point”.
- **THME-02 (durability + fallback):** `tests/ui/theme-baseline.spec.js` cases “switches from settings entry and persists after restart” and “falls back for invalid persisted theme and shows repair prompt path”.
- **THME-03 (readability):** matrix above + `.planning/phases/13-theme-baseline/13-CONTRAST-LOG.md`.
- **Pass-gate status:** no deferred success criteria in Plan 13-04.

## D-08 Repair Prompt Evidence Chain

1. Tamper persisted config with invalid custom id (`损坏主题`).
2. Relaunch app and verify:
   - safe fallback to `默认深色`,
   - retained invalid id metadata in `theme-config.json`,
   - settings repair prompt visible.
3. Select valid built-in theme from repair prompt and verify retained-invalid metadata is cleared.

Evidence: `tests/ui/theme-baseline.spec.js` fallback case, `tests/ui/helpers/theme-baseline-fixtures.js`.
