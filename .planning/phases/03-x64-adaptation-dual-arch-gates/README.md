# Phase 3 Runbook: x64 Adaptation & Dual-Arch Gates

## Phase 3 boundary

- no Phase 4 integration verification
- no Phase 5 promotion actions

## Execution model

- Process libraries in baseline order (`.planning/baselines/inventory-baseline.json`).
- For every library, run both lanes:
  - x64 primary lane
  - x86 comparison lane
- Keep blocked libraries in retry queue; continue remaining libraries.
- Phase remains incomplete until blocked queue is cleared.

## Commands

```bash
npm run x64:adapt
npm run x64:check
npm run test:migration:x64
npm run test:migration && npm run test:migration:x64
```

## Blocked-library retry procedure

1. Run `npm run x64:check` and inspect blocked enums in:
   - `.planning/phases/03-x64-adaptation-dual-arch-gates/reports/libraries/*.json`
2. Fix ABI or arch artifacts for blocked libraries.
3. Re-run `npm run x64:adapt`.
4. Re-run `npm run x64:check`.
5. Repeat until blocked libraries are zero.

## Reporting

- Library main view fields:
  - `library`, `batchId`, `x64Result`, `x86Result`,
  - `abi.pointerWidth`, `abi.structLayoutAlignment`, `abi.callbackSignature`,
  - `blockedReasonCode`, `nextAction`, `status`
- Phase summary includes progress thermometer:
  - `completedLibraries`, `blockedLibraries`, `remainingLibraries`
