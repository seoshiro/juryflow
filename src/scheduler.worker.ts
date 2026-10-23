import { solve } from './engine';
import type { WorkerRequest, WorkerResponse } from './types';
self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  try { const result = solve(data.project, { previous: data.previous, timeBudgetMs: 1800, maxNodes: 120000 }); self.postMessage({ id: data.id, result } satisfies WorkerResponse); }
  catch { self.postMessage({ id: data.id, error: 'The scheduler could not finish. Check event data and try again.' } satisfies WorkerResponse); }
};
