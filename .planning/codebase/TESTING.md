# Testing Patterns

**Analysis Date:** 2026-03-21

## Test Framework

**Runner:**
- Playwright `@playwright/test` (from `package.json` devDependencies, `^1.52.0`)
- Config: `playwright.config.js`

**Assertion Library:**
- Playwright `expect` API (`tests/ui/electron-start.spec.js`)

**Run Commands:**
```bash
npm run test:ui              # Build then run all Playwright UI tests
npm run test:ui:smoke        # Build then run startup smoke test only
npx playwright test          # Direct Playwright invocation (uses playwright.config.js)
```

## Test File Organization

**Location:**
- Separate test directory under `tests/ui/` for Electron UI tests (not co-located with source).

**Naming:**
- `*.spec.js` naming for UI tests (`tests/ui/electron-start.spec.js`).

**Structure:**
```text
tests/
└── ui/
    └── electron-start.spec.js
```

## Test Structure

**Suite Organization:**
```javascript
const { test, expect, _electron: electron } = require('@playwright/test');

test.describe('ycIDE Electron startup', () => {
  test('launches and shows the main window', async () => {
    // precondition checks for built outputs
    // launch electron app
    // UI assertions
  });
});
```

**Patterns:**
- Setup pattern: validate build artifacts before launch (`out/main/index.js`, `out/renderer/index.html`) in `tests/ui/electron-start.spec.js`.
- Runtime pattern: launch packaged app root with `_electron.launch({ args: [appRoot], cwd: appRoot })`.
- Teardown pattern: always close launched app in `finally` (`await electronApp.close()`).
- Assertion pattern: use visibility/text checks against key shell elements (`.titlebar`, `.sidebar`, empty project state labels).

## Mocking

**Framework:** Not used in current repository tests.

**Patterns:**
```javascript
// Current strategy is real-app launch, no mocking:
const electronApp = await electron.launch({
  args: [appRoot],
  cwd: appRoot,
  env: { ...process.env, CI: '1' },
});
```

**What to Mock:**
- Not applicable in current test suite; tests are end-to-end startup checks against real Electron runtime.

**What NOT to Mock:**
- Do not mock main window boot path and renderer shell visibility for smoke tests; keep assertions against actual DOM in launched app (`tests/ui/electron-start.spec.js`).

## Fixtures and Factories

**Test Data:**
```javascript
const appRoot = path.resolve(__dirname, '..', '..');
const builtMainEntry = path.join(appRoot, 'out', 'main', 'index.js');
const builtRendererEntry = path.join(appRoot, 'out', 'renderer', 'index.html');
```

**Location:**
- Inline constants inside test files (`tests/ui/electron-start.spec.js`).
- No shared fixture/factory modules detected.

## Coverage

**Requirements:** None enforced (no coverage tooling or thresholds detected for Playwright/UI tests).

**View Coverage:**
```bash
Not applicable
```

## Test Types

**Unit Tests:**
- Not detected in project source (`src/` contains no `*.test.*` or `*.spec.*` files).

**Integration Tests:**
- Not detected as a separate layer.

**E2E Tests:**
- Playwright-based Electron UI smoke test in `tests/ui/electron-start.spec.js`.
- Execution configured by `playwright.config.js`:
  - `testDir: './tests/ui'`
  - `workers: 1`
  - `fullyParallel: false`
  - `trace: 'on-first-retry'`
  - `screenshot: 'only-on-failure'`
  - `video: 'retain-on-failure'`
  - results in `test-results/`

## Common Patterns

**Async Testing:**
```javascript
const window = await electronApp.firstWindow();
await window.waitForLoadState('domcontentloaded');
await expect(window.locator('.titlebar')).toBeVisible();
```

**Error Testing:**
```javascript
// Guard assertions before launch to fail fast:
expect(fs.existsSync(builtMainEntry)).toBeTruthy();
expect(fs.existsSync(builtRendererEntry)).toBeTruthy();
```

---

*Testing analysis: 2026-03-21*
