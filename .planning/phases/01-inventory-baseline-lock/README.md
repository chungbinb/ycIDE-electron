# Phase 01 Inventory Baseline Operations

This phase defines one authoritative inventory baseline artifact for unmigrated third-party libraries.

## Commands

```bash
npm run inventory:baseline
npm run inventory:check
```

Operator workflow:
1. Run `npm run inventory:baseline` to regenerate `.planning/baselines/inventory-baseline.json`.
2. Run `npm run inventory:check` to verify required keys and metric consistency.

## Manifest Schema

The baseline manifest at `.planning/baselines/inventory-baseline.json` includes:
- `generatedAt`
- `roots.thirdParty[]` and `roots.migrated`
- `totals.candidateCount`
- `totals.migratedCount`
- `totals.remainingCount`
- `totals.coveragePct`
- `libraries[]` rows with `name`, `sourceRoot`, `isMigrated`
- every unmigrated row also includes `archState` and `encodingState`

## Authority Boundary

Only `.planning/baselines/inventory-baseline.json` is authoritative for Phase 1 inventory status.
Runtime userData files (for example Electron app state under userData) are non-authoritative and must not be used as baseline truth.
