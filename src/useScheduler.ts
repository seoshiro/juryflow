import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Assignment, SavedDocument, SolveResult, WorkerResponse } from './types';
import { demoDocument } from './demo';
import { restoreDraft, serializeDocument } from './io';
const KEY = 'juryflow.document.v1';
function initial(): { document: SavedDocument; error: string } {
  try { const raw = localStorage.getItem(KEY); if (raw) { const parsed = restoreDraft(raw); if (parsed.ok) return { document: parsed.value, error: '' }; localStorage.setItem('juryflow.recovery.v1', raw); return { document: demoDocument(), error: `Saved event could not be restored: ${parsed.error} A recovery copy remains in browser storage (juryflow.recovery.v1).` }; } }
  catch { return { document: demoDocument(), error: 'Browser storage is unavailable. Export JSON to keep your work.' }; }
  return { document: demoDocument(), error: '' };
}
export function useScheduler() {
  const [loaded] = useState(initial); const [document, update] = useState(loaded.document); const [error, setError] = useState(loaded.error);
  const [result, setResult] = useState<SolveResult | null>(null); const [busy, setBusy] = useState(false);
  const current = useRef(document); current.current = document;
  const worker = useRef<Worker | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const sequence = useRef(0);
  const stop = useCallback(() => { worker.current?.terminate(); worker.current = null; clearTimeout(timer.current); }, []);
  const cancel = useCallback(() => { sequence.current++; stop(); setBusy(false); setResult({ status: 'cancelled', assignments: [], issues: [{ code: 'cancelled', message: 'Search cancelled. Your previous plan is preserved for comparison.' }], nodes: 0, elapsedMs: 0, changedCount: 0, preferenceProven: false }); }, [stop]);
  const setDocument: Dispatch<SetStateAction<SavedDocument>> = useCallback(value => {
    stop(); sequence.current++; setBusy(false); setResult(null);
    update(prev => { const next = typeof value === 'function' ? value(prev) : value; current.current = next; return next; });
  }, [stop]);
  useEffect(() => { try { localStorage.setItem(KEY, serializeDocument(document)); } catch { setError('Could not save in this browser. Export JSON to keep your work.'); } }, [document]);
  useEffect(() => () => stop(), [stop]);
  const run = useCallback((previous?: Assignment[]) => {
    stop(); const id = ++sequence.current; const snapshot = structuredClone(current.current); setBusy(true); setError(''); setResult(null);
    try {
      const active = new Worker(new URL('./scheduler.worker.ts', import.meta.url), { type: 'module' }); worker.current = active;
      active.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.id !== sequence.current) return; stop(); setBusy(false);
        if (data.error) { setError(data.error); return; }
        if (data.result) { const solved = data.result; setResult(solved); if (solved.status === 'feasible') update(doc => ({ ...doc, schedule: solved.assignments, baseline: previous?.length ? previous : doc.baseline.length ? doc.baseline : solved.assignments })); }
      };
      active.onerror = () => { if (id !== sequence.current) return; stop(); setBusy(false); setError('The scheduling worker could not start. Reload the app and try again.'); };
      timer.current = setTimeout(() => { if (id !== sequence.current) return; stop(); setBusy(false); setResult({ status: 'unknown', assignments: [], issues: [{ code: 'timeout', message: 'Search reached its safety limit. Feasibility is unknown; simplify constraints and retry.' }], nodes: 0, elapsedMs: 5000, changedCount: 0, preferenceProven: false }); }, 5000);
      active.postMessage({ id, project: snapshot.project, previous });
    } catch { stop(); setBusy(false); setError('This browser could not start a Web Worker. Try a current browser.'); }
  }, [stop]);
  const resetDemo = useCallback(() => { setError(''); setDocument(prev => ({ ...demoDocument(), language: prev.language })); }, [setDocument]);
  return { document, setDocument, result, busy, error, run, cancel, resetDemo };
}
