# Phase 1: Inventory & Baseline Lock - Research

**Researched:** 2026-03-21  
**Domain:** Migration inventory baselining (unmigrated library discovery + status classification + coverage manifest)  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

`CONTEXT.md` was not found for this phase. Fallback constraints below are taken from `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md`.

### Locked Decisions
- Compatibility must preserve current ycIDE support-library consumption flow.
- Scope is migration-only (no unrelated IDE feature work).
- Platform/toolchain is Windows-centric with x64 target support required.
- Source inputs are heterogeneous under `第三方相关文件`; per-library handling is required.
- Phase 1 must satisfy INVT-01, INVT-02, INVT-03 only.

### the agent's Discretion
- Implementation language/tooling for inventory generation.
- Manifest/report format and location.
- Classification heuristics for architecture and encoding states.
- Automation entrypoint (script command layout and output strategy).

### Deferred Ideas (OUT OF SCOPE)
- Encoding conversion implementation (Phase 2+).
- x64 code adaptation implementation (Phase 3+).
- ycIDE runtime integration verification (Phase 4+).
- Promotion/rollback delivery pipeline (Phase 5+).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INVT-01 | Generate complete list of libraries in `第三方相关文件` not yet in `支持库源码` | Set-based inventory pattern (source-root enumeration + target-root diff), deterministic directory rules, manifest schema with `isMigrated` |
| INVT-02 | Classify each unmigrated library by architecture (`x86-only`/`mixed`/`x64-ready`) and encoding (`gbk`/`mixed`/`utf-8`) | Architecture detection heuristics (x86/x64 folder/build artifact probes), encoding classifier strategy (BOM + strict UTF-8 + GBK decode fallback + unknown bucket) |
| INVT-03 | Authoritative manifest/report with migration coverage % and remaining count | Single-writer baseline manifest design (`generatedAt`, totals, per-library rows), derived metrics (`coveragePct`, `remainingCount`), idempotent regeneration command |
</phase_requirements>

## Summary

Phase 1 should be implemented as a deterministic **filesystem inventory pipeline** that compares library names between `第三方相关文件/易语言的功能库|易语言的界面库` and `支持库源码`, then writes one authoritative baseline report file committed in-repo. This directly satisfies the “single source of truth” intent and avoids hidden state in app runtime files.

Repository evidence shows the active third-party candidate roots are clear and finite. Current measured baseline from a reproducible scan in this repo: **67 total candidates**, **5 migrated intersection libraries** (`bmpoperate`, `btdownload`, `cncnv`, `cnvpe`, `commobj`), **62 remaining**, **7.46% coverage**. This confirms Phase 1 is still largely discovery and tracking work.

Primary planning risk is misclassification quality (especially encoding): many libraries classify as `mixed` unless detection is explicit and conservative. Therefore, classify “confidently known” states only, and keep uncertain files visible instead of forcing false precision.

**Primary recommendation:** Build a Node/TypeScript inventory command that regenerates `inventory-baseline.json` from disk every run, with conservative architecture/encoding heuristics and derived coverage metrics.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js runtime | v24.13.0 (local) | File walking, classification, manifest generation | Already project runtime, no cross-stack introduction |
| TypeScript | ^5.7.0 (repo) | Typed inventory schema + maintainable logic | Aligns with existing codebase conventions |
| fast-glob | 3.3.3 (npm, published 2025-01-05) | Deterministic recursive matching for inventory probes | Reliable, widely used for predictable file discovery |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chardet | 2.1.1 (npm, published 2025-10-29) | Secondary heuristic encoding hint for ambiguous files | Use only after strict UTF-8/GBK checks disagree |
| iconv-lite | 0.7.2 (npm, published 2026-01-08) | Explicit GBK/CP936 decode and UTF-8 encode verification | Use for deterministic conversion-read checks in classification |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node+TS inventory script | PowerShell-only script | Faster start, but weaker typing/reuse and harder unit-testability |
| fast-glob | Native `fs.readdir` recursion only | No dependency, but more custom traversal edge-case code |
| chardet + explicit decoder checks | Pure BOM-based detection | Simpler but too weak for mixed legacy corpus |

**Installation:**
```bash
npm install -D fast-glob chardet iconv-lite
```

**Version verification:**
```bash
npm view fast-glob version
npm view chardet version
npm view iconv-lite version
```
Verified in research session: `fast-glob@3.3.3`, `chardet@2.1.1`, `iconv-lite@0.7.2`.

## Architecture Patterns

### Recommended Project Structure
```text
.planning/
  baselines/
    inventory-baseline.json     # authoritative manifest (committed)
scripts/
  migration/
    inventory-baseline.ts       # inventory generator CLI entry
    classify-arch.ts            # architecture heuristics
    classify-encoding.ts        # encoding heuristics
tests/
  migration/
    inventory-baseline.spec.ts  # requirement-mapped tests
```

### Pattern 1: Set-Diff Baseline Generation
**What:** Enumerate third-party library dirs, enumerate migrated support-source dirs, diff by normalized library name.
**When to use:** INVT-01 baseline regeneration and CI verification.
**Example:**
```ts
// Source: project scan pattern in src/main/library-manager.ts + repo roots
const thirdPartyNames = new Set(listDirs(['第三方相关文件/易语言的功能库', '第三方相关文件/易语言的界面库']))
const migratedNames = new Set(listDirs(['支持库源码']))
const rows = [...thirdPartyNames].map((name) => ({
  name,
  isMigrated: migratedNames.has(name)
}))
```

### Pattern 2: Conservative Classification with Explicit Unknowns
**What:** For arch/encoding, infer only when evidence is present; otherwise classify `mixed` (not guessed).
**When to use:** INVT-02 quality gate.
**Example:**
```ts
// Source: repo audit heuristics validated in research run
archState = hasX64 && hasX86 ? 'mixed' : hasX64 ? 'x64-ready' : 'x86-only'
encodingState = hasOnlyUtf8 ? 'utf-8' : hasOnlyGbk ? 'gbk' : 'mixed'
```

### Anti-Patterns to Avoid
- **Multiple baseline files per tool:** causes metric drift; keep one authoritative output.
- **Incremental-in-place counters without full rescan:** leads to stale coverage numbers.
- **Treating uncertain encoding as GBK/UTF-8 by default:** hides risk for Phase 2.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recursive globbing across mixed tree depths | Ad-hoc recursive walker with manual path filters | `fast-glob` | Fewer path and exclusion bugs |
| Encoding heuristics | Custom byte-probability detector from scratch | `chardet` + strict decoder checks | Legacy encoding detection is error-prone |
| Manifest serialization conventions | Free-form text output only | JSON schema with explicit fields | Planner and later phases need machine-readable baseline |

**Key insight:** Phase 1 is a data-quality phase; precision and repeatability beat clever custom logic.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `app.getPath('userData')/library-state.json` persists loaded support libs (from `src/main/library-manager.ts`) but is not Phase 1 baseline authority | **Code edit only:** do not use this runtime file as baseline source; baseline must come from repo filesystem scan |
| Live service config | None found (no external service-backed migration config in this repo context) | None |
| OS-registered state | None found for Phase 1 scope | None |
| Secrets/env vars | None found affecting inventory baseline generation (`.env*` not detected) | None |
| Build artifacts | Existing packaged/build outputs under `out/`, `dist/`, `test-results/` are non-authoritative and can mislead scans if not excluded | **Code edit only:** enforce exclusions in scanner patterns |

## Common Pitfalls

### Pitfall 1: Wrong scope roots
**What goes wrong:** Scanner includes unrelated `第三方相关文件` folders (e.g., zips, docs, helper projects) and inflates totals.  
**Why it happens:** Using broad recursive root instead of requirement-defined library roots.  
**How to avoid:** Hard-code scope to `易语言的功能库` and `易语言的界面库` for INVT baseline.  
**Warning signs:** Candidate count spikes unexpectedly across reruns.

### Pitfall 2: Name-only false matches
**What goes wrong:** A same-name folder in `支持库源码` is treated as migrated even if content lineage differs.  
**Why it happens:** No provenance/hash fields in manifest.  
**How to avoid:** Add optional hash/fingerprint fields now (even if informational).  
**Warning signs:** Coverage improves with no observable migration activity.

### Pitfall 3: Encoding overconfidence
**What goes wrong:** Files are labeled UTF-8 due to permissive decode, masking GBK edge cases.  
**Why it happens:** Non-strict decoder paths or BOM-only logic.  
**How to avoid:** Use strict UTF-8 decode first, strict GBK fallback, then classify as `mixed` if ambiguous.  
**Warning signs:** Nearly all libraries report `utf-8` despite known legacy sources.

## Code Examples

Verified patterns from repository and runtime checks:

### Deterministic coverage computation
```ts
// Source: phase research command output (2026-03-21)
const totalCandidates = 67
const migrated = 5
const remaining = totalCandidates - migrated
const coveragePct = Number(((migrated / totalCandidates) * 100).toFixed(2)) // 7.46
```

### Authoritative manifest shape
```json
{
  "generatedAt": "2026-03-21T00:00:00.000Z",
  "roots": {
    "thirdParty": ["第三方相关文件/易语言的功能库", "第三方相关文件/易语言的界面库"],
    "migrated": "支持库源码"
  },
  "totals": {
    "candidateCount": 67,
    "migratedCount": 5,
    "remainingCount": 62,
    "coveragePct": 7.46
  },
  "libraries": [
    {
      "name": "console",
      "sourceRoot": "易语言的功能库",
      "isMigrated": false,
      "archState": "x86-only",
      "encodingState": "mixed"
    }
  ]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One-off conversion scripts (e.g., `convert_commobj.py`, `do_convert.ps1`) | Repeatable inventory-first baseline manifest before bulk migration | Needed now for Phase 1 | Prevents blind migration and enables coverage tracking |
| Manual visual estimation of progress | Computed coverage (`migrated/total`) from deterministic scan | Phase 1 target | Enables objective go/no-go for later phases |

**Deprecated/outdated:**
- Script-per-library progress tracking as primary status source (insufficient for INVT-03 authoritative reporting).

## Open Questions

1. **Canonical identity beyond folder name**
   - What we know: Current measurable diff uses directory-name intersection.
   - What's unclear: Need hash/provenance tie-break for potential name collisions.
   - Recommendation: Add optional `fingerprint` fields now; enforce in later phases if collisions appear.

2. **Encoding target file extensions for Phase 1 classification**
   - What we know: Mixed corpus includes C/C++ and 易语言-related text assets.
   - What's unclear: Exact extension whitelist to include/exclude for baseline.
   - Recommendation: Lock a documented extension set in Wave 0 tests.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright `@playwright/test` `^1.52.0` (existing); no migration-unit framework yet |
| Config file | `playwright.config.js` |
| Quick run command | `npm run test:ui:smoke` |
| Full suite command | `npm run test:ui` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INVT-01 | Complete unmigrated list generation from scoped roots | unit/integration (Node script) | `node scripts/migration/inventory-baseline.ts --check-list` | ❌ Wave 0 |
| INVT-02 | Per-library arch + encoding classification | unit | `node scripts/migration/inventory-baseline.ts --check-classification` | ❌ Wave 0 |
| INVT-03 | Single authoritative manifest with coverage metrics | integration | `node scripts/migration/inventory-baseline.ts --check-manifest` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node scripts/migration/inventory-baseline.ts --check-manifest`
- **Per wave merge:** `node scripts/migration/inventory-baseline.ts --regenerate && npm run test:ui:smoke`
- **Phase gate:** Manifest regeneration + INVT checks green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `scripts/migration/inventory-baseline.ts` — core generator for INVT-01/02/03
- [ ] `tests/migration/inventory-baseline.spec.ts` — deterministic assertions for counts/classification
- [ ] Minimal Node test harness config for migration scripts (or explicit script self-check mode)

## Sources

### Primary (HIGH confidence)
- Repository requirements/phase docs:
  - `D:\chungbin\ycIDE-html\.planning\REQUIREMENTS.md`
  - `D:\chungbin\ycIDE-html\.planning\ROADMAP.md`
  - `D:\chungbin\ycIDE-html\.planning\PROJECT.md`
- Repository implementation context:
  - `D:\chungbin\ycIDE-html\src\main\library-manager.ts` (scan/load state behavior)
  - `D:\chungbin\ycIDE-html\src\main\index.ts` (IPC and runtime state context)
  - `D:\chungbin\ycIDE-html\convert_commobj.py`
  - `D:\chungbin\ycIDE-html\do_convert.ps1`
- Verified package versions via npm registry:
  - `npm view fast-glob version time`
  - `npm view chardet version time`
  - `npm view iconv-lite version time`
- Direct filesystem inventory scans executed during research (PowerShell outputs recorded in session).

### Secondary (MEDIUM confidence)
- Node.js API docs (for planned implementation patterns):
  - https://nodejs.org/api/fs.html
  - https://nodejs.org/api/path.html

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — aligned to existing project stack, versions verified on npm.
- Architecture: **HIGH** — directly derived from repo structure and requirement mapping.
- Pitfalls: **MEDIUM** — partly inferred from corpus behavior; should be confirmed in Wave 0 tests.

**Research date:** 2026-03-21  
**Valid until:** 2026-04-20 (30 days; phase domain is relatively stable)
