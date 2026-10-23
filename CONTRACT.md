# JURYFLOW implementation contract

Fresh isolated project directory: `juryflow/`. No other repositories are part of this project.
React + TypeScript + Vite, static output, no accounts/backend/paid dependencies.
Canonical shared types: `src/types.ts`. Slots are zero-based fixed duration, date/startTime interpreted UTC. All availability arrays are explicit. Each team has judgeCount, required and excluded judge IDs. All rooms and judges cannot overlap at a slot. Locks fix a whole assignment.

## Exclusive ownership
- Integrator: config, src/types.ts, src/demo.ts, src/io.ts, src/useScheduler.ts, src/scheduler.worker.ts, README/CI/public/deployment. Do not alter other repositories.
- Engine worker: only src/engine/** and tests/engine*.test.ts. Export solve(project, options): SolveResult; validateSchedule(project, assignments): Issue[] from src/engine/index.ts. Validate input before search. Deterministic bounded backtracking. Time/node limit -> unknown unless feasible incumbent. No false minimal explanations/optimality.
- UI worker: only src/App.tsx, src/components/**, src/styles.css. Imports demoProject() from ./demo, useScheduler() hook, IO from ./io. Hook returns { document, setDocument, result, busy, error, run(previous?), cancel, resetDemo }. run uses current project; previous optional for replan. IO exports parseDocument(text), serializeDocument(doc), exportICS(project, assignments), downloadText(name,text,mime), slotLabel(project, slot). Return parseDocument as {ok:true, value:SavedDocument}|{ok:false,error:string}. App fully editable teams/judges/rooms/event settings, schedule grid, locks, constraints, demo disruption, import/export, print, RU/EN. UI must invalidate displayed current schedule when constraints change, retaining baseline for replan. Never show stale schedule as validated.
- QA worker: tests/e2e/**, playwright.config.ts, docs/QA.md only. May read all; report integration defects rather than edit source. Independent adversarial tests final integrated build. Do not overwrite package/config; request needed scripts.

## Demo
12 synthetic teams, 3 judges, 2 rooms; fixed-length slots. Baseline real solver output. Demo outage removes judge availability from later slots, triggers invalidation then replan(previous). Show changed teams, no unwarranted minimum-disruption claim. All schedule exports use current validated assignments.

## Acceptance
Tests: overlap, availability, invalid locks, unsatisfiable, deterministic, limits. Reload persistence, validated schema-versioned import, export consistency. Keyboard and 390px browser E2E, no console errors, typecheck/lint/build. Genuine screenshots. Public repository only after secret/content review; free GitHub Pages deployment; exact remote commit/live artifact verification.
