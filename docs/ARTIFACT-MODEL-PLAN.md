# IU → 1-to-many Artifacts + Per-Region Drift

## Why
An IU is a *unit of intent* (a regenerative grain). A file is an artifact of the
*compile target*. Binding them 1:1 couples the grain to one implementation's file
layout. Real backends need:
- **one IU → many files** (migration + schema + routes + …), and
- **many IUs → one shared file** (the migrations table, a shared schema, routing).

So the relationship is **many-to-many**, mediated by the architecture target. The
target owns the file layout; the IU owns *roles* of content, some **owned**
(exclusive file) and some **contributions** to a **shared aggregate** file.

The migration is the perfect first case: it is intrinsically shared (it's why we hit
the duplicate-`CREATE TABLE` bug — two IUs fought over one concern).

## Increment 1 (this pass): shared `migrations` aggregate + per-region drift

### Model (`models/manifest.ts`)
- `FileRegion { iu_id, role, content_hash, start_line, end_line }`
- `SharedFileManifest { path, content_hash, regions[] }`
- `GeneratedManifest.shared_files?: Record<path, SharedFileManifest>`
- `DriftEntry` gains optional `role`, `region` (start/end line) so drift attributes to
  the owning IU *and* the specific region.

### Artifact split (`artifacts.ts`, NEW)
`splitSharedArtifacts(results, target)`:
1. Extract every `registerMigration('table', \`…\`)` from each IU module (the migration
   is a `migration`-role contribution, not module-owned content).
2. Remove it from the module; **remap that module's `line_provenance`** (line indices
   shift when the block is removed) so inspector provenance stays exact.
3. Dedupe by table name (keep first owner) — kills duplicate `CREATE TABLE` structurally.
4. Assemble `src/generated/_migrations.ts`: each contribution wrapped in
   `// <<phx:region iu=… role=migration table=…>> … // <</phx:region>>`.
5. Return updated results + the `SharedFileManifest` + the side-effect import path.

### Manifest (`manifest.ts`)
- `load()` defaults `shared_files: {}`.
- `recordSharedFiles(SharedFileManifest[])`.

### Drift (`drift.ts`)
- Iterate `shared_files`. Fast path: whole-file hash matches → all regions clean.
  Else parse region markers on disk, hash each region body, compare to manifest region
  by `(iu_id, role)`, emit one `DriftEntry` per region (CLEAN/DRIFTED/WAIVED/MISSING)
  carrying `iu_id`, `role`, `region` lines.

### Scaffold (`scaffold.ts`)
- `generateScaffold(..., sharedImports: string[])` adds `import './generated/_migrations.js';`
  to `server.ts` *before* `runMigrations()` so registrations still run.

### CLI (`cli.ts`)
- `cmdBootstrap` + `cmdRegen`: after `generateAll`, call `splitSharedArtifacts`, write
  the shared file, `recordSharedFiles`, pass `sharedImports` to scaffold. Drift report
  prints per-region lines for shared files.

### Tests
- `artifacts.test.ts`: extraction, line-provenance remap, dedupe, region offsets.
- `drift-region.test.ts`: clean / single-region drift attributed to the right IU.

## Status: Increment 1 SHIPPED ✅
Verified end-to-end on Trail: 4 modules → 1 shared `_migrations.ts` with 4 owned
regions; modules no longer self-register; `server.ts` imports the aggregate before
`runMigrations()`; app boots on a fresh DB and serves `/issue` + `/sprint` (tables
created from the shared file); board renders with **0 console errors / 0 exceptions /
0 failed requests**. `phoenix drift` localizes a single-region edit to
`migration:sprints (sprint) L58–69` while every other region/file stays clean.
Partial regen (`regen --iu=board`) preserved the other 3 migration regions. 465 tests.

### Bug found + fixed along the way (generator, per "fix Phoenix not output")
The board shipped a browser-fatal `SyntaxError`. Root cause was TWO gate gaps:
1. **Cooked-form blindness** — inline `<script>` lives inside `c.html(`…`)`, so the
   browser sees the TEMPLATE-LITERAL-COOKED text. Source `', \'' +` (valid escaped
   quote) collapses to `', '' +` (two adjacent strings) at render. `validateInlineScripts`
   checked raw source → missed it. Now it cooks escapes + neutralizes `${…}` first.
2. **Retry-only placement** — inline validation ran only inside the fix loop, so a
   first-try-clean typecheck skipped it. Now it gates the initial pass too.
Regenerating the board through the fixed gate produced correct `addEventListener` +
`data-*` code. Two regression tests added.

## Compile Gate — "the assembled system must compile, honestly" (SHIPPED ✅)
The purist follow-on. Per-IU typecheck during generation has incomplete sibling
context, so cross-module / declaration-emit errors slipped through and shipped under a
green ✔. Phoenix now treats the build as the most basic eval:
- `compile-gate.ts`: after every IU + shared artifact + scaffold is written, `tsc` the
  WHOLE project. While the LLM is available, repair offending **generated** files
  (feeding tsc's own errors back) for a few rounds; never touch hand-written scaffold.
  Folds inline-`<script>` validation in too. Returns unresolved errors.
- Honest reporting: repaired files refresh their manifest hash (drift stays clean) and
  drop now-stale exact provenance; unresolved errors become negative knowledge +
  diagnostics + a persisted `.phoenix/build-status.json`; the trust dashboard shows
  `Build: compiles | N error(s)`. No silent ✔ on code that doesn't compile.
- Generation rule added: narrow nullables INLINE (TS doesn't carry narrowing through a
  stored boolean) — fixed the `sprint.capacity` class at the source.

The gate immediately earned its keep on Trail: it fixed sprint-rollup at the source,
then surfaced a **previously-masked** real error in the scaffold (`db.ts` TS4023 from
`declaration: true` on an app) and refused to auto-edit hand-written scaffold — root-
caused to the architecture target's tsconfig (apps don't emit `.d.ts`). After the fix:
`tsc` exits 0, gate reports `project compiles`, board renders with 0 console errors.
472 tests.

## Later increments (not now)
- Generalize roles beyond migration (schema, routing, OpenAPI) — target declares the
  layout + merge.
- Inspector renders shared files + region ownership.
- `output_files` → `artifacts: Artifact[]` on the IU model (role-typed).
