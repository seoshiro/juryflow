# A one-minute JURYFLOW demo

1. **0–10s — Meet the event.** Open the app and reset the demo if needed. Frontier / Demo Day has 12 synthetic teams, 3 judges, 2 rooms and 15-minute slots. One assignment is locked; another team requires a judge and another excludes a judge.
2. **10–20s — Build the schedule.** Select **Generate schedule**. Read the validated state and room/time grid. Every team is scheduled once; judges cannot be in two rooms simultaneously.
3. **20–35s — Introduce a real change.** Use the demo judge-outage control. The current plan becomes stale; its original assignments remain as the comparison baseline. Replan with the previous schedule as a preference.
4. **35–45s — See what moved.** The change list shows the actual before/after time, room and panel differences. Unchanged teams and locks stay visible. Read the solver wording: a valid repair, without an unproven minimum claim.
5. **45–55s — Make constraints visible.** Open a team or judge editor to inspect availability, required judges and conflicts of interest. A contradictory event produces a clear diagnosis instead of a fake successful plan.
6. **55–60s — Take it with you.** Export JSON for a full editable backup, ICS for a UTC calendar, or print the current valid schedule. Reload to confirm local persistence.

The demo does not use prerecorded schedules. Generation and replanning run in the real engine in a Web Worker. Result timing varies with the device; the search and worker both have explicit limits.
