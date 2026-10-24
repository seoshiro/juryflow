import { expect, it } from 'vitest';
import { demoDocument } from '../src/demo';
import { solve } from '../src/engine';
import { DOCUMENT_KEY, loadDocument, persistDocument } from '../src/persistence';
import { exportICS, parseDocument, restoreDraft, serializeDocument } from '../src/io';

it('rejects unrestorable drafts before replacing the last good event', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const original = demoDocument();
  expect(persistDocument(storage, original, null).status).toBe('saved');
  const saved = values.get(DOCUMENT_KEY);
  for (const patch of [{ date: '10000-01-01' }, { date: '2026-02-30' }, { startTime: '99:99' }, { name: 'University\u0085pitch' }, { name: 'x'.repeat(161) }]) {
    const draft = { ...original, project: { ...original.project, ...patch } };
    expect(persistDocument(storage, draft, null).status).toBe('error');
    expect(values.get(DOCUMENT_KEY)).toBe(saved);
    expect(loadDocument(storage).recovery).toBeNull();
  }
});

it('rejects ambiguous baseline identities while retaining historical references', () => {
  const doc = demoDocument();
  doc.schedule = solve(doc.project).assignments;
  const first = doc.schedule[0];
  doc.baseline = [first, { ...first, slot: first.slot + 1 }];
  expect(parseDocument(serializeDocument(doc)).ok).toBe(false);
  expect(restoreDraft(serializeDocument(doc)).ok).toBe(false);
  doc.baseline = [{ ...first, teamId: 'historical-removed-team', roomId: 'historical-room' }];
  expect(parseDocument(serializeDocument(doc)).ok).toBe(true);
});

it('rejects calendar rollover instead of emitting malformed extended-year timestamps', () => {
  const doc = demoDocument();
  doc.project.date = '9999-12-31';
  doc.project.startTime = '23:55';
  const schedule = solve(doc.project).assignments;
  expect(schedule.length).toBe(12);
  expect(() => exportICS(doc.project, schedule)).toThrow('four-digit year');
});

it('preserves a solved plan across unfinished display labels and draft reload', () => {
  const draft = demoDocument();
  draft.schedule = solve(draft.project).assignments;
  draft.baseline = structuredClone(draft.schedule);
  const schedule = structuredClone(draft.schedule);
  draft.project.name = '';
  draft.project.teams[0].name = '  ';
  draft.project.judges[0].name = '';
  draft.project.rooms[0].name = '';
  const restored = restoreDraft(serializeDocument(draft));
  expect(restored.ok).toBe(true);
  if (!restored.ok) return;
  expect(restored.value.schedule).toEqual(schedule);
  expect(restored.value.baseline).toEqual(schedule);
  expect(restored.value.project.teams[0].name).toBe('  ');
  expect(parseDocument(serializeDocument(draft)).ok).toBe(false);
});
