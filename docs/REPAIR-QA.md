# Independent audit regression review

Target baseline: public release `1b4120604039fc4e315b1ad35d32d5bc73d42bf9`.
All data is synthetic and all browser contexts are isolated. The original audit
directory was read only; reproduction scripts write only into this repository's
ignored `test-results/` tree.

## Baseline observations

On 2026-10-23, `tests/e2e/repair-baseline.mjs` independently reproduced all nine
findings on the original public release:

| Issue | Actual baseline result |
| --- | --- |
| UI-01 | Sequential keys `2`, `0` produced field `50` and stored minutes `50`. |
| SEC-01 | Original 522,631-byte metadata fixture was accepted, serialized to 2,345,754 characters, failed export and restored the demo after reload. |
| SEC-02 | Native localStorage quota reached with 5,237,100 ballast characters; copying corrupt raw raised `QuotaExceededError`; reload overwrote the primary raw and no backup existed. |
| ALG-01 | Gated `File.text()` completion of A replaced newer import B and an explicit Reset with `Slow event A`. |
| UI-02 | Escape after opening a schedule dialog left focus on BODY. |
| ALG-02 | Required panel `["a,b", "c"]` replaced `["a", "b,c"]`, but Changes showed zero. |
| UI-04 | Visible Regenerate / Russian regenerate labels retained `Generate schedule` as their accessible name; Russian dialog retained Done. |
| UI-03 | Dismiss error left the induced worker-start failure alert visible. |
| UI-05 | At 320 px the status text measured 40.1875 px wide and 257 px tall. |

Committed observation snapshot: `tests/fixtures/repair-baseline-observations.json`.
The script also writes a transient `test-results/repair-baseline/observations.json`;
Playwright clears that output directory on subsequent runs. Browser
instrumentation is limited to an explicit file-read gate and aborting the test
worker request. Native quota uses actual Storage, not a mocked exception.

## Regression gate

Final frozen local candidate: **26/26 Chromium E2E passed in 53.1 seconds**
(the original 10 scenarios plus 16 new audit regressions). The actual production
bundle tested was `index-CmanZzAQ.js`; implementation source was unchanged during
this independent run. Recovery and Russian-dialog axe checks are included in
that full pass with **zero violations** for `wcag2a`, `wcag2aa`, `wcag21aa`.
Direct visible/name assertions cover EN regenerate and RU regenerate, outage,
dialog and replan states. Live verification remains a separate release gate.

Earlier integrated candidate `index-yuNFHAQz.js` passed the initial 25 tests in
54.0 s. A further integration ordering check then exposed a related ALG-01
variant: an older worker could finish during a newer gated file read, causing
the newer import to be silently ignored. That new regression failed against
the first candidate (expected the new file, actual demo). The repair cancels
an older worker at the start of a supported import, before awaiting file text.
The final full 26-test pass includes this regression: the old worker produces
no schedule and the newer file is applied. This is recorded separately from
the original nine baseline findings rather than hidden by the earlier pass.

| Issue | Repaired candidate observation |
| --- | --- |
| UI-01 | Real sequential typing preserves 20, blur/Enter commit correctly, invalid 121 does not replace the saved value, and a later valid value survives reload. Slot-count editing also stays buffered. |
| SEC-01 | Exact original 522,631-byte file is accepted with unknown metadata removed; canonical export is importable and reload preserves the event. UTF-8 byte overflow rejects before replacing current data. |
| SEC-02 | Real native quota still raises `QuotaExceededError`; the same 5,723-character corrupt raw remains unchanged through reload and ordinary edits, downloads exactly, and requires confirmation before replacement. Canceling replacement preserves it; accepting a valid replacement persists. |
| ALG-01 | Gated older file A cannot overwrite newer B, Reset, or a document edit after its read completes. Each result also survives reload. Conversely, an older in-flight worker cannot invalidate a newer file import. |
| UI-02 | Escape, Done and X return focus to the original schedule card; editor opener restoration and a removed-card fallback to main workspace pass. |
| ALG-02 | Original valid comma-ID fixture now shows one changed card and a before/after change row with the actual old/new judges. |
| UI-04 | Visible EN/RU regenerate/outage/replan commands agree with accessible names; Russian dialog helper/control text and team-name label are translated. |
| UI-03 | Induced worker startup error dismisses; unblocking the worker permits a valid retry. No page or console errors were observed in this run. The test separately records and narrowly permits only an actual induced `net::ERR_FAILED` console message if emitted by Chromium. |
| UI-05 | At 320 px the status text is **215 px × 55 px**, versus baseline 40.1875 px × 257 px. Actions occupy a separate row; no page overflow. |

- `tests/e2e/repair.spec.ts` contains assertions for all nine findings, including
  sequential keystrokes, blur/Enter validation, real quota, exact raw download,
  canceled/confirmed recovery replacement, stale A/B/reset/edit races, all
  dialog close paths and fallback focus, comma IDs, localized commands and
  measured 320 px status layout.
- Console and unhandled page errors are recorded separately. Page errors must
  always be zero. Only the explicitly induced network error is allowed in the
  worker-request-abort scenario; a successful retry is required.
- `tests/e2e/repair-oracle.mjs` preserves the original independent oracle
  body and seed. `oracle-runtime.mjs` adapts only module transpilation/resolution
  into an ignored directory, including the new shared assignment helper.
  Its original diagnostic `uiComparisonSaysChanged: false` deliberately evaluates
  the old comma-join expression and is preserved as a legacy demonstration; it
  does not inspect the repaired UI. The separate browser comma-panel regression
  must observe one changed assignment in the current UI.

Original independent oracle rerun: **800 feasibility cases**, **231 replans**
checked against exhaustive minimum changed count, **100 deterministic repeats**,
666 cases with multiple judges and 69 with locks; `failures: []`. Additional
limits/cancellation/invalid-lock/validator/UTC/JSON checks in the original body
also pass. This finite small-case oracle is not a proof of every large event.

## Real screenshots

Captured from the running final candidate and visually inspected:

- [Readable 320 px status](screenshots/repair-status-320.png)
- [Recovery guard and raw download](screenshots/repair-recovery.png)
- [Russian dialog](screenshots/repair-russian-dialog.png)
- [Capture measurements](screenshots/repair-capture-evidence.json)

## Reproduce

```sh
npm run build
npm run test:e2e
node tests/e2e/repair-oracle.mjs
```

Set `E2E_BASE_URL` to the public deployment to run the same browser regressions
against the live artifact. The original-baseline observation script is intended
for the old release; its assertions are not substituted for repaired tests.

Review checklist: `21st-ui-review`. The optional 21st CLI is unavailable; no
packages or paid tools were installed. Runtime checks use installed Playwright
Chromium. This does not establish coverage for Safari/Firefox, manual screen
readers, physical printers, every storage implementation, or prolonged sessions.
