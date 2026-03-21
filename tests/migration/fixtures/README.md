# Migration Inventory Fixtures

Fixtures for `inventory-baseline.spec.mjs` should model deterministic Phase 1 inventory behavior.

Coverage targets:
- **INVT-01:** candidate enumeration and unmigrated set-diff behavior.
- **INVT-02:** required classifier enums for every unmigrated row.
- **INVT-03:** totals and coverage metric consistency in manifest output.

This phase currently validates against live repository roots to guarantee command-level contract coverage.
