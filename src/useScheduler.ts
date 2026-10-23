import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Assignment, SavedDocument, SolveResult, WorkerResponse } from './types';
import { demoDocument } from './demo';
import { restoreDraft, serializeDocument } from './io';
import { loadDocument, persistDocument } from './persistence';
import type { Recovery, StorageAccess } from './persistence';

function browserStorage(): StorageAccess | null {
  try { return window.localStorage; } catch { return null; }
}

export function useScheduler() {
  const [loaded] = useState(() => loadDocument(browserStorage()));
  const [document, update] = useState(loaded.document);
  const [recovery, setRecovery] = useState<Recovery | null>(loaded.recovery);
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'paused' | 'error'>('paused');
  const [result, setResult] = useState<SolveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef(document);
  current.current = document;
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sequence = useRef(0);
  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    clearTimeout(timer.current);
  }, []);
  const clearError = useCallback(() => setError(''), []);
  // Only an explicit UI decision releases recovery. Dismissing an alert cannot do so.
  const discardRecovery = useCallback(() => {
    setRecovery(null);
    setError('');
    setSaveState('paused');
  }, []);
  const cancel = useCallback(() => {
    sequence.current++;
    stop();
    setBusy(false);
    setResult({ status: 'cancelled', assignments: [], issues: [{ code: 'cancelled', message: 'Search cancelled. Your previous plan is preserved for comparison.' }], nodes: 0, elapsedMs: 0, changedCount: 0, preferenceProven: false });
  }, [stop]);
  const setDocument: Dispatch<SetStateAction<SavedDocument>> = useCallback(value => {
    stop();
    sequence.current++;
    setBusy(false);
    setResult(null);
    setSaveState('paused');
    update(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      current.current = next;
      return next;
    });
  }, [stop]);
  // Presentation changes do not invalidate constraints, results or a running worker.
  const setLanguage = useCallback((language: SavedDocument['language']) => {
    update(prev => {
      const next = { ...prev, language };
      current.current = next;
      return next;
    });
  }, []);
  /** Validate/canonicalize before atomically replacing the event and releasing recovery. */
  const replaceDocument = useCallback((value: SavedDocument): boolean => {
    try {
      const parsed = restoreDraft(serializeDocument(value));
      if (!parsed.ok) { setError(parsed.error); return false; }
      stop();
      sequence.current++;
      setBusy(false);
      setResult(null);
      setError('');
      setRecovery(null);
      setSaveState('paused');
      current.current = parsed.value;
      update(parsed.value);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This event could not replace the current document.');
      return false;
    }
  }, [stop]);
  useEffect(() => {
    const saved = persistDocument(browserStorage(), document, recovery);
    setSaveState(saved.status === 'saved' ? 'saved' : saved.status === 'blocked' ? 'paused' : 'error');
    if (saved.status === 'error') setError(saved.message);
  }, [document, recovery]);
  useEffect(() => () => stop(), [stop]);
  const run = useCallback((previous?: Assignment[]) => {
    stop();
    const id = ++sequence.current;
    const snapshot = structuredClone(current.current);
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const active = new Worker(new URL('./scheduler.worker.ts', import.meta.url), { type: 'module' });
      worker.current = active;
      active.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.id !== sequence.current) return;
        stop();
        setBusy(false);
        if (data.error) { setError(data.error); return; }
        if (data.result) {
          const solved = data.result;
          setResult(solved);
          if (solved.status === 'feasible') {
            setSaveState('paused');
            update(doc => ({ ...doc, schedule: solved.assignments, baseline: previous?.length ? previous : doc.baseline.length ? doc.baseline : solved.assignments }));
          }
        }
      };
      active.onerror = () => {
        if (id !== sequence.current) return;
        stop();
        setBusy(false);
        setError('The scheduling worker could not start. Reload the app and try again.');
      };
      timer.current = setTimeout(() => {
        if (id !== sequence.current) return;
        stop();
        setBusy(false);
        setResult({ status: 'unknown', assignments: [], issues: [{ code: 'timeout', message: 'Search reached its safety limit. Feasibility is unknown; simplify constraints and retry.' }], nodes: 0, elapsedMs: 5000, changedCount: 0, preferenceProven: false });
      }, 5000);
      active.postMessage({ id, project: snapshot.project, previous });
    } catch {
      stop();
      setBusy(false);
      setError('This browser could not start a Web Worker. Try a current browser.');
    }
  }, [stop]);
  // Reset alone does not authorize overwriting an unreadable saved event.
  const resetDemo = useCallback(() => {
    setError('');
    setDocument(prev => ({ ...demoDocument(), language: prev.language }));
  }, [setDocument]);
  return { document, setDocument, setLanguage, replaceDocument, result, busy, error, clearError, recovery, discardRecovery, saveState, run, cancel, resetDemo };
}
