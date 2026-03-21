# Phase 3: x64 Adaptation & Dual-Arch Gates - Research

**Researched:** 2026-03-21  
**Domain:** Per-library x64 adaptation workflow, ABI-sensitive validation, deterministic dual-arch gating for ycIDE support libraries  
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### 适配单元策略
- **D3-01:** 以“库”为主单元推进：每库完成 x64 适配与门禁后再推进下一库。
- **D3-02:** 库内按“最小可验证批次”拆分：每次只处理一组紧耦合 ABI 风险点并立即验证。
- **D3-03:** 库间执行顺序固定按 Phase 2 baseline 顺序。
- **D3-04:** 某库失败时允许继续后续库，但该库标记 `blocked` 并进入修复队列。

### 双架构对比门禁
- **D3-05:** 每个库都必须执行 x64 主验证 + x86 对照验证（非抽样）。
- **D3-06:** 若 x86 对照失败且 x64 通过，仍判定该库失败，不允许放行。
- **D3-07:** 每库输出统一差异摘要：通过项/失败项/差异项固定清单。
- **D3-08:** 最小必检维度固定为三类：指针宽度、结构体布局/对齐、回调签名。

### 失败与放行规则
- **D3-09:** 阶段通过阈值为严格模式：所有目标库均需完成并通过双架构门禁。
- **D3-10:** ABI 风险证据不完整时立即阻断该库并要求补证，不可带病推进。
- **D3-11:** 阻断库允许重复重试，只有通过后才计入阶段完成。
- **D3-12:** 允许先推进后续库，但阶段状态保持未完成直到阻断清零。

### 结果呈现粒度
- **D3-13:** 主报告采用“库级主视图 + 阶段汇总”结构。
- **D3-14:** 每库固定字段：库名、批次、x64 结果、x86 对照结果、三类必检结论、阻断原因、下一步动作。
- **D3-15:** 阶段汇总必须包含“进度温度计”（完成库数/阻断库数/剩余库数）。
- **D3-16:** 阻断原因使用固定枚举，支持跨库统计与趋势跟踪。

### the agent's Discretion
- 固定枚举的具体编码与文案命名。
- 阶段汇总“温度计”展示格式（表格/百分比/组合）。
- 库内最小批次命名规范与批次 ID 规则。

### Deferred Ideas (OUT OF SCOPE)
- ycIDE 运行时/加载链路级集成验证（Phase 4）
- 推广到 `支持库源码` 的原子发布与可追踪交付（Phase 5）
- 与非迁移目标相关的功能扩展
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| X64A-01 | Maintainer can adapt each targeted library build/config/source to produce x64-compatible outputs. | Per-library adaptation workflow, dual-arch artifact expectations (`lib/x64`, `static_lib/x64`), and deterministic queueing from baseline order. |
| X64A-02 | Adaptation process validates pointer-width/ABI-sensitive changes (types, struct layout/alignment, callback signatures) for each migrated library. | ABI-sensitive check matrix with three mandatory dimensions and explicit evidence requirements per library batch. |
| X64A-03 | Adapted libraries can pass x64 build verification with failure surfaced explicitly when adaptation is incomplete. | Strict gate design (`blocked` on missing/failed evidence), failure taxonomy enums, and deterministic per-library/phase reporting model. |
| X64A-04 | Migration process preserves an x86 comparison lane for regression diagnostics during transition. | Mandatory non-sampled x86 comparison lane per library, with x86 failure forcing library failure even if x64 passes (D3-06). |
</phase_requirements>

## Summary

Phase 3 should be planned as a **migration-script phase**, not an IDE integration phase. The repository already has the right primitives: deterministic baseline ordering (`inventory-baseline.json`), per-library report pipelines (`convert-encoding.mjs`), strict phase gating, and node:test contract style. The x64 adaptation plan should reuse this structure directly so implementation remains auditable and consistent with Phase 2.

Current code confirms dual-arch capability exists in runtime/compiler plumbing: compilation accepts `arch` and maps to `--target=i686-pc-windows-msvc` or `--target=x86_64-pc-windows-msvc`; library loading already has `lib/x64` + `lib/x86`; static link lookup already branches on architecture in `findStaticLib(name, arch)`. Phase 3 therefore should focus on **library-by-library ABI evidence and gates**, not redesigning architecture selection.

The key planning risk is false confidence from filename-level architecture hints (`classify-arch.mjs`) and basic compile pass/fail checks. Phase 3 must require explicit ABI-sensitive evidence (pointer width, struct layout/alignment, callback signatures) and deterministic failure reasons per library, while keeping x86 as required comparison lane.

**Primary recommendation:** Implement Phase 3 as a new deterministic migration pipeline (`scripts/migration/x64-adaptation.mjs` + `tests/migration/x64-adaptation.spec.mjs`) that mirrors Phase 2 report/gate semantics but enforces dual-arch + ABI-evidence completion per library.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | v24.13.0 (local) | Migration scripts + node:test execution | Already used by all migration scripts/tests; zero new runtime surface. |
| node:test (built-in) | bundled with Node 24 | Contract tests for X64A-01..04 | Matches existing `tests/migration/*.spec.mjs` style and tooling. |
| koffi | project `^2.15.1` (latest verified `2.15.2`, 2026-03-11) | FFI metadata loading of `.fne` (`fne-parser.ts`) | Existing core dependency for support-library metadata and ABI-facing boundaries. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| iconv-lite | project `^0.7.2` (latest verified `0.7.2`, 2026-01-08) | Existing deterministic text conversion pipeline dependency | Reuse only for report/text handling consistency; not central to ABI checks. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node:test contracts | Jest/Vitest | Adds framework/config overhead and diverges from established migration test style. |
| Phase-specific script under `scripts/migration` | Integrate logic into Electron runtime/compiler | Blurs phase boundary and weakens deterministic offline gating/reporting. |

**Installation:**
```bash
npm install
```

**Version verification:**  
- `npm view koffi version time --json` → latest `2.15.2`, published `2026-03-11`  
- `npm view iconv-lite version time --json` → latest `0.7.2`, published `2026-01-08`

## Architecture Patterns

### Recommended Project Structure
```text
scripts/
└── migration/
    ├── x64-adaptation.mjs         # per-library dual-arch gate engine (new)
    └── classify-arch.mjs          # pre-existing architecture hinting

tests/
└── migration/
    ├── x64-adaptation.spec.mjs    # X64A-01..04 contracts (new)
    └── fixtures/x64-adaptation/   # ABI edge-case fixtures (new)

.planning/phases/03-x64-adaptation-dual-arch-gates/
└── reports/
    ├── libraries/*.json           # per-library results (new)
    └── phase-summary.json         # strict phase gate + progress thermometer (new)
```

### Pattern 1: Baseline-ordered per-library queue (reuse Phase 2)
**What:** Read `.planning/baselines/inventory-baseline.json`, process only unmigrated libraries, preserve deterministic order.  
**When to use:** All phase-wide migration gates requiring reproducible outputs.  
**Example:**
```javascript
const baseline = await readBaseline(repoRoot)
const queue = baseline.libraries.filter((row) => !row.isMigrated)
for (const row of queue) {
  const report = await processLibrary(row, { repoRoot })
  reports.push(report)
}
```
Source: `scripts/migration/convert-encoding.mjs`

### Pattern 2: Dual-arch compile lane from existing compiler contract
**What:** Force both `x64` and `x86` compile checks for each library adaptation batch.  
**When to use:** Every library in Phase 3 (D3-05/06 non-optional).  
**Example:**
```typescript
if (arch === 'x86') {
  args.push('--target=i686-pc-windows-msvc')
} else {
  args.push('--target=x86_64-pc-windows-msvc')
}
```
Source: `src/main/compiler.ts`

### Pattern 3: Strict blocked-first gate semantics
**What:** Library fails if required evidence is missing or any lane fails; phase fails until blocked libraries clear.  
**When to use:** Reporting and go/no-go calculations.  
**Example:**
```javascript
if (strictGate && !summary.phaseGatePassed) {
  throw new Error('Strict phase gate failed')
}
```
Source: `scripts/migration/convert-encoding.mjs`

### Anti-Patterns to Avoid
- **Compile-only validation:** Passing compile without ABI evidence is insufficient for X64A-02.
- **Sampling x86 lane:** D3-05 requires non-sampled x86 comparison for every library.
- **Free-text failure notes:** Use fixed enums (D3-16), not ad-hoc prose-only reasons.
- **Phase bleed:** Do not add ycIDE runtime integration checks (Phase 4) or promotion workflow (Phase 5).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Arch target switching | Custom target inference logic | Existing compiler arch switch (`arch` + `--target=...`) | Already implemented and battle-tested in repo runtime. |
| Library ordering/scope | Manual list/spreadsheet | `inventory-baseline.json` deterministic queue | Prevents drift and guarantees reproducible sequencing. |
| Phase reporting format | One-off text logs | JSON per-library + phase summary pattern from Phase 2 | Enables machine checks, trend tracking, and deterministic diffs. |
| ABI validation bookkeeping | Manual checklist docs only | Script-enforced ABI matrix fields + node:test assertions | Prevents missing evidence from slipping through. |

**Key insight:** Phase 3 risk is governance/verification quality, not raw script complexity—reuse deterministic machinery and enforce ABI evidence completeness mechanically.

## Common Pitfalls

### Pitfall 1: Treating filename architecture hints as ABI proof
**What goes wrong:** `classify-arch.mjs` reports status from path hints (`x64`, `x86`) but ABI bugs remain undetected.  
**Why it happens:** Fast heuristic mistaken for compatibility validation.  
**How to avoid:** Require explicit per-library ABI matrix evidence for pointer width, struct layout/alignment, callback signatures.  
**Warning signs:** Library marked `x64-ready` but x64 lane crashes/ABI mismatch appears.

### Pitfall 2: Passing x64 lane but ignoring x86 diagnostics lane
**What goes wrong:** Regression cannot be localized during transition; violates D3-06.  
**Why it happens:** Teams optimize for target lane only.  
**How to avoid:** Gate library success on both lanes; x86 failure keeps library blocked even if x64 passes.  
**Warning signs:** Reports omit x86 result fields or classify x86 failures as informational.

### Pitfall 3: Non-deterministic reporting fields
**What goes wrong:** Diff churn and unclear progress; planner cannot trust trend metrics.  
**Why it happens:** Unstable ordering/free-form status strings.  
**How to avoid:** Stable sorting, fixed enum taxonomy, fixed field set per D3-14/16.  
**Warning signs:** Same run produces different report ordering or reason labels.

## Code Examples

Verified patterns from repository sources:

### Per-library deterministic report object
```javascript
const report = {
  library: row.name,
  sourceRoot: row.sourceRoot,
  total: files.length,
  scanned: 0,
  converted: 0,
  skipped: 0,
  blocked: 0,
  blockedReasons: [],
  sampleFiles: [],
  status: 'success'
}
```
Source: `scripts/migration/convert-encoding.mjs`

### Architecture-aware static library resolution
```typescript
findStaticLib(name: string, arch: string): string | null {
  const archDir = arch === 'x86' ? 'x86' : 'x64'
  const candidates = [
    join(staticFolder, archDir, `${name}_static.lib`),
    join(staticFolder, archDir, `${name}.lib`)
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}
```
Source: `src/main/library-manager.ts`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ad-hoc migration actions | Deterministic baseline-driven migration scripts + strict reports | Established by Phase 1/2 (2026-03-21 artifacts) | Enables repeatability and strict gate automation for Phase 3. |
| Encoding-only strict gates | Need ABI-sensitive dual-arch strict gates | Phase 3 target | Same governance model can be extended to x64 adaptation. |
| Manual architecture assumptions | Explicit `arch` compile target mapping in compiler | Already in current codebase | Clear mechanism exists for dual-lane verification automation. |

**Deprecated/outdated:**
- Treating `classify-arch.mjs` output as final compatibility proof: keep as pre-screen only.

## Open Questions

1. **How to generate ABI evidence per library without over-reaching into Phase 4 integration?**
   - What we know: Required dimensions are fixed (pointer width, struct layout/alignment, callback signatures).
   - What's unclear: Exact fixture corpus per library type.
   - Recommendation: Plan Wave 0 fixture taxonomy by library class (functional vs UI/window-unit) with minimal representative ABI probes.

2. **How strict should enum taxonomy be for blocked reasons?**
   - What we know: D3-16 requires fixed enum for cross-library statistics.
   - What's unclear: Final enum names/codes.
   - Recommendation: Freeze short machine codes (e.g., `missing_x64_artifact`, `abi_pointer_mismatch`, `abi_layout_mismatch`, `abi_callback_mismatch`, `x86_lane_failed`, `evidence_incomplete`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (Node v24.13.0 built-in) |
| Config file | none — direct `node --test` scripts in package.json |
| Quick run command | `node --test --test-name-pattern "X64A-01|X64A-02" tests/migration/x64-adaptation.spec.mjs` |
| Full suite command | `npm run test:migration && node --test tests/migration/x64-adaptation.spec.mjs` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| X64A-01 | Each targeted library yields x64-compatible artifact set or explicit blocked status | integration-contract | `node --test --test-name-pattern "X64A-01" tests/migration/x64-adaptation.spec.mjs -x` | ❌ Wave 0 |
| X64A-02 | ABI matrix evidence present for pointer width + layout/alignment + callback signatures | unit+contract | `node --test --test-name-pattern "X64A-02" tests/migration/x64-adaptation.spec.mjs -x` | ❌ Wave 0 |
| X64A-03 | x64 lane failures are surfaced with deterministic reason enums and gate fail | integration-contract | `node --test --test-name-pattern "X64A-03" tests/migration/x64-adaptation.spec.mjs -x` | ❌ Wave 0 |
| X64A-04 | x86 comparison lane runs for every library and can fail gate independently | integration-contract | `node --test --test-name-pattern "X64A-04" tests/migration/x64-adaptation.spec.mjs -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test --test-name-pattern "X64A-01|X64A-02" tests/migration/x64-adaptation.spec.mjs`
- **Per wave merge:** `node --test tests/migration/x64-adaptation.spec.mjs`
- **Phase gate:** `npm run test:migration && node --test tests/migration/x64-adaptation.spec.mjs` and strict check command (planned): `node scripts/migration/x64-adaptation.mjs --check`

### Wave 0 Gaps
- [ ] `tests/migration/x64-adaptation.spec.mjs` — covers X64A-01..04 contract assertions
- [ ] `tests/migration/fixtures/x64-adaptation/README.md` — ABI-sensitive fixture matrix and expected outcomes
- [ ] `scripts/migration/x64-adaptation.mjs` — deterministic dual-arch gate engine and report writer
- [ ] `package.json` scripts: `x64:adapt`, `x64:check`, `test:migration:x64`

## Deterministic Reporting Model (Planner Input)

### Per-library JSON schema (required fields)
`library`, `batchId`, `x64Result`, `x86Result`, `abi.pointerWidth`, `abi.structLayoutAlignment`, `abi.callbackSignature`, `blockedReasonCode[]`, `nextAction`, `status`

### Phase summary JSON schema (required fields)
`totalLibraries`, `completedLibraries`, `blockedLibraries`, `remainingLibraries`, `progressThermometer`, `blockedReasonStats`, `phaseGatePassed`

### Failure taxonomy (recommended fixed enums)
- `missing_x64_artifact`
- `missing_x86_artifact`
- `x64_lane_failed`
- `x86_lane_failed`
- `abi_pointer_mismatch`
- `abi_layout_mismatch`
- `abi_callback_signature_mismatch`
- `abi_evidence_incomplete`
- `report_invariant_mismatch`

## Sources

### Primary (HIGH confidence)
- `.planning/phases/03-x64-adaptation-dual-arch-gates/03-CONTEXT.md` — locked decisions D3-01..D3-16 and phase boundary
- `.planning/ROADMAP.md` — Phase 3 goal/success criteria and requirement IDs
- `.planning/REQUIREMENTS.md` — X64A-01..X64A-04 definitions
- `.planning/phases/02-deterministic-encoding-conversion/02-VERIFICATION.md` — reusable strict-gate/reporting evidence
- `scripts/migration/convert-encoding.mjs` — deterministic queue/report/gate pattern
- `tests/migration/encoding-conversion.spec.mjs` — existing node:test contract style
- `scripts/migration/inventory-baseline.mjs` — baseline ordering/scope model
- `scripts/migration/classify-arch.mjs` — current architecture heuristic limitations
- `src/main/compiler.ts` — arch compile targets and link failure surfacing
- `src/main/library-manager.ts` — dual-arch library/static-lib resolution
- `.planning/config.json` — `workflow.nyquist_validation: true` (Validation Architecture included)
- `package.json` + npm registry checks (`npm view`) — package/version verification

### Secondary (MEDIUM confidence)
- None (no external docs were required for repo-specific planning constraints)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — based on current repository dependencies + npm registry version verification
- Architecture: HIGH — directly verified from current scripts/compiler/library-manager code
- Pitfalls: MEDIUM — derived from code constraints + migration pattern extrapolation for new Phase 3 checks

**Research date:** 2026-03-21  
**Valid until:** 2026-04-20

## Planning Implications (Concise)

1. Plan Phase 3 as one deterministic migration engine + one contract test suite + one runbook/report set (same delivery shape as Phase 2).
2. Make dual-arch gating mandatory per library (x64 + x86), with x86 failures blocking completion.
3. Encode ABI-sensitive evidence as machine-verifiable matrix fields, not narrative notes.
4. Freeze blocked-reason enums early; downstream planning and trend reporting depend on them.
5. Keep strict boundary: no Phase 4 loader/runtime integration and no Phase 5 promotion logic in this phase.
