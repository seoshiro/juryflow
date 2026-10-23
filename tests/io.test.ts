import { describe, expect, it } from 'vitest';
import { demoDocument, demoProject } from '../src/demo';
import { MAX_DOCUMENT_BYTES, exportICS, parseDocument, restoreDraft, serializeDocument, slotLabel } from '../src/io';
import { solve } from '../src/engine';
describe('document boundary', () => {
  it('normalizes the audit metadata fixture before export and reload', () => {
    const doc = demoDocument();
    const raw = JSON.stringify({ ...doc, ignoredRoot: 'ignored', project: { ...doc.project, auditMetadata: Array(260000).fill(0) } });
    const parsed = parseDocument(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.hasOwn(parsed.value.project, 'auditMetadata')).toBe(false);
    const exported = serializeDocument(parsed.value);
    expect(new TextEncoder().encode(exported).length).toBeLessThanOrEqual(2_000_000);
    expect(restoreDraft(exported)).toEqual(parsed);
    expect(parseDocument(exported)).toEqual(parsed);
  });
  it('measures imported data as UTF-8 bytes instead of UTF-16 character count', () => {
    const raw = JSON.stringify({ ...demoDocument(), ignoredMetadata: '\u0416'.repeat(1_000_000) });
    expect(raw.length).toBeLessThan(2_000_000);
    expect(new TextEncoder().encode(raw).length).toBeGreaterThan(2_000_000);
    expect(parseDocument(raw).ok).toBe(false);
  });
  it('whitelists every entity and assignment while preserving supported fields', () => {
    const doc = demoDocument(); doc.baseline = [...doc.project.locks];
    const extra = { extraMetadata: { privateNote: 'not schema data' } };
    const raw = JSON.stringify({ ...doc, ...extra, baseline: doc.baseline.map(a => ({ ...a, ...extra })), project: {
      ...doc.project, ...extra,
      teams: doc.project.teams.map(t => ({ ...t, ...extra })),
      judges: doc.project.judges.map(j => ({ ...j, ...extra })),
      rooms: doc.project.rooms.map(r => ({ ...r, ...extra })),
      locks: doc.project.locks.map(a => ({ ...a, ...extra })),
    } });
    expect(parseDocument(raw)).toEqual({ ok: true, value: doc });
    expect(restoreDraft(serializeDocument(doc))).toEqual({ ok: true, value: doc });
  });
  it('enforces the same UTF-8 byte limit when serializing an oversized in-memory draft', () => {
    const doc = demoDocument(); doc.project.name = '\u0416'.repeat(MAX_DOCUMENT_BYTES / 2);
    expect(() => serializeDocument(doc)).toThrow('UTF-8 limit');
  });
  it('round trips versioned documents', () => { const doc = demoDocument(); expect(parseDocument(serializeDocument(doc))).toEqual({ ok: true, value: doc }); });
  it('restores unfinished local edits while keeping imported JSON strict', () => { const doc = demoDocument(); doc.project.name = ''; doc.project.date = ''; doc.project.startTime = ''; doc.project.teams[0].name = ''; const raw = serializeDocument(doc); expect(restoreDraft(raw)).toEqual({ ok: true, value: doc }); expect(parseDocument(raw).ok).toBe(false); });
  it.each(['{', '{}', '{"schemaVersion":2}', 'null', '[]'])('rejects invalid or unsupported input %s', raw => { expect(parseDocument(raw).ok).toBe(false); });
  it('rejects duplicate IDs, broken references and nonexistent dates', () => {
    const docs = [demoDocument(), demoDocument(), demoDocument()];
    docs[0].project.teams[1].id = docs[0].project.teams[0].id;
    docs[1].project.teams[1].requiredJudgeIds = ['missing'];
    docs[2].project.date = '2026-02-31';
    for (const doc of docs) expect(parseDocument(serializeDocument(doc)).ok).toBe(false);
  });
  it('rejects oversized imports and out-of-range slots', () => { expect(parseDocument(' '.repeat(2_000_001)).ok).toBe(false); const doc = demoDocument(); doc.project.judges[0].availableSlots = [99]; expect(parseDocument(serializeDocument(doc)).ok).toBe(false); });
  it('rejects invalid stored schedules rather than displaying them as validated', () => { const doc = demoDocument(); doc.schedule = [{ teamId: 'team-1', slot: 0, roomId: 'room-a', judgeIds: ['judge-1'] }]; expect(parseDocument(serializeDocument(doc)).ok).toBe(false); });
});
describe('calendar export', () => {
  it('exports exactly one UTC event per visible assignment, with correct room and judges', () => {
    const p = demoProject(); const result = solve(p); expect(result.status).toBe('feasible'); const ics = exportICS(p, result.assignments).replace(/\r\n /g, '');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(12); expect(ics).toContain('DTSTART:20261114T090000Z'); expect(ics).toContain('LOCATION:Forum A'); expect(ics).toContain('SUMMARY:Orbit Notes'); expect(ics).toContain('Robin Chen'); expect(ics.endsWith('\r\n')).toBe(true);
  });
  it('escapes calendar text and folds UTF-8 lines', () => { const p = demoProject(); p.teams[0].name = 'Я'.repeat(70) + ',;\\End'; const result = solve(p); const ics = exportICS(p, result.assignments); expect(ics.replace(/\r\n /g, '')).toContain('\\,\\;\\\\End'); for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75); });
  it('refuses stale, partial or empty schedule exports', () => { const p = demoProject(); expect(() => exportICS(p, [])).toThrow(); expect(() => exportICS(p, [p.locks[0]])).toThrow(); });
  it('handles slots across midnight explicitly', () => { const p = demoProject(); p.startTime = '23:45'; expect(slotLabel(p, 1)).toBe('00:00 +1d'); });
});
