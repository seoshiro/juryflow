import { expect, it } from 'vitest';
import { demoDocument } from '../src/demo';
import { solve, validateProject, validateSchedule } from '../src/engine';
import { exportICS, parseDocument, serializeDocument, restoreDraft } from '../src/io';

it('rejects sparse availability instead of returning a feasible undefined slot', () => {
  const project = demoDocument().project;
  for (const entity of [...project.teams, ...project.judges, ...project.rooms]) entity.availableSlots = new Array(1);
  expect(validateProject(project).length).toBeGreaterThan(0);
  expect(solve(project).status).toBe('infeasible');
});

it('keeps calendar UIDs distinct when project and team IDs contain hyphens', () => {
  const uids = [['audit-a-b', 'c'], ['audit-a', 'b-c']].map(([projectId, teamId]) => {
    const project = demoDocument().project;
    project.id = projectId;
    project.teams = [{ ...project.teams[0], id: teamId }];
    project.locks = [];
    const result = solve(project);
    expect(result.status).toBe('feasible');
    return exportICS(project, result.assignments).replace(/\r\n /g, '').split('\r\n').find(line => line.startsWith('UID:'));
  });
  expect(uids[0]).not.toBe(uids[1]);
});

it('rejects holes and executable indexes in entity and assignment arrays', () => {
  const project = demoDocument().project;
  project.judges = new Array(1);
  expect(() => validateProject(project)).not.toThrow();
  expect(validateProject(project).length).toBeGreaterThan(0);
  let calls = 0;
  const safe = demoDocument().project;
  Object.defineProperty(safe.teams, '0', { enumerable: true, get() { calls++; return undefined; } });
  expect(validateProject(safe).length).toBeGreaterThan(0);
  expect(calls).toBe(0);
  expect(validateSchedule(demoDocument().project, new Array(1)).length).toBeGreaterThan(0);
});

it('rejects C1 control characters consistently at import and draft recovery', () => {
  for (const code of [127, 128, 133, 159]) {
    const doc = demoDocument();
    doc.project.name = `Name${String.fromCharCode(code)}control`;
    const json = serializeDocument(doc);
    expect(parseDocument(json).ok).toBe(false);
    expect(restoreDraft(json).ok).toBe(false);
  }
});
