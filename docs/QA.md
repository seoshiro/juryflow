# Independent QA

Scope: integrated production build, scheduling constraints, disruption replanning,
persistence, import/export, keyboard access, 390px layout, and browser errors.

Test runner: Playwright Chromium. Each browser test starts with isolated storage.
Exported schedules are checked independently of the scheduling engine: team,
room and judge availability, room/judge overlap, panel size, required judges,
conflicts of interest and locks must all hold.

## Execution record

2026-10-23: independent Chromium run against the production `dist` build on
`http://127.0.0.1:4173/`: **10 passed in 22.0 seconds** on the final frozen UI. Browser package:
Playwright Chromium 156.0.8078.4 (revision 1248).

| Check | Observed result |
| --- | --- |
| Demo schedule | All 12 synthetic teams placed, independently validated against every hard constraint |
| Judge outage / replan | Four panels changed; eight assignments retained; every resulting assignment valid |
| Reload | Edited project, schedule and completed replanning persisted |
| Import | Malformed JSON, unsupported schema and invalid event data rejected without replacing the current project |
| Infeasibility | Unsatisfiable constraints produced an honest explanation and no displayed schedule |
| Locks | Imported lock and a lock created through the real dialog survived generation/replanning |
| Constraint edit | Changing pitch duration invalidated the current schedule, retained comparison baseline and replanned successfully |
| Unfinished draft | Blank team/event names, date and start time survived reload; strict JSON import/export rejected incomplete event fields |
| Accessibility | axe WCAG 2 A/AA and WCAG 2.1 AA scans returned no violations on desktop schedule, 390px schedule, all editors and team dialog |
| Keyboard | Enter generated a schedule/opened the dialog; dialog contained tab focus; Escape closed it |
| Narrow layout | No document horizontal overflow at 390px for agenda, judge/room editors or event setup |
| Print | Printable schedule produced a PDF; a three-room configuration retained all four time/room columns |
| Exports | JSON matched the visible teams/current schedule; ICS contained the 12 current events |
| Browser errors | No console errors or uncaught page errors in any of the ten scenarios |
| RU/EN | Russian UI/document language survived reload, generated successfully at 390px, and switched back to English |

Two earlier runs exposed low-contrast labels/button text. Those findings were
fixed in UI source, rebuilt and checked again with the full suite. No axe rules
were disabled. Source review also found mismatched UI/import limits and the
unfinished-draft restore boundary; the integrated tests cover the resulting fixes.

The disruption count is an observation from this demo, **not a claim that four
changes are globally minimal**. The automated accessibility checks and Chromium
coverage do not replace manual assistive-technology or cross-browser testing.

## Reproduce

```sh
npm ci
npx playwright install chromium
npm run build
npm run test:e2e
```

The Playwright configuration starts Vite's production preview automatically.
Set `E2E_BASE_URL` to test the same scenarios against an existing deployment.
To capture the demo, start `npm run preview -- --port 4173`, then run
`node tests/e2e/capture.mjs`. On Windows PowerShell, use `npm.cmd` when forwarding
CLI flags through npm.

## Real screenshots

Captured from the built running app, with no fabricated UI:

- [Desktop schedule](screenshots/schedule-desktop.png)
- [After judge outage and replan](screenshots/replan-desktop.png)
- [390px mobile agenda](screenshots/mobile-agenda.png)
- [Capture metadata](screenshots/capture-evidence.json)

Live-deployment verification is recorded separately after publication; this
record currently establishes the local production-build results only.
