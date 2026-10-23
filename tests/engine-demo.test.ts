import { expect, it } from 'vitest';
import { demoProject } from '../src/demo';
import { solve, validateSchedule } from '../src/engine';

it('runs the actual 12-team demo and replans a judge outage with unchanged time and room assignments', () => {
  const project = demoProject();
  const baseline = solve(project, { timeBudgetMs: 10_000 });
  expect(baseline.status).toBe('feasible');
  expect(baseline.assignments).toHaveLength(12);
  expect(project.judges).toHaveLength(3);
  expect(project.rooms).toHaveLength(2);
  project.judges[0].availableSlots = [0, 1];
  expect(validateSchedule(project, baseline.assignments).some(value => value.code === 'judge-unavailable')).toBe(true);
  const after = solve(project, { previous: baseline.assignments, timeBudgetMs: 10_000 });
  expect(after.status).toBe('feasible');
  expect(validateSchedule(project, after.assignments)).toEqual([]);
  expect(after.changedCount).toBe(4);
  expect(after.preferenceProven).toBe(true);
  for (const assignment of after.assignments) {
    const previous = baseline.assignments.find(value => value.teamId === assignment.teamId)!;
    expect(assignment.slot).toBe(previous.slot);
    expect(assignment.roomId).toBe(previous.roomId);
  }
});

it('keeps a valid incumbent when the disruption improvement search hits its node budget', () => {
  const project = demoProject();
  const baseline = solve(project).assignments;
  project.judges[0].availableSlots = [0, 1];
  const result = solve(project, { previous: baseline, maxNodes: 3_000, timeBudgetMs: 10_000 });
  expect(result.status).toBe('feasible');
  expect(validateSchedule(project, result.assignments)).toEqual([]);
  expect(result.nodes).toBe(3_000);
  expect(result.preferenceProven).toBe(false);
  expect(result.issues.some(value => value.code === 'preference-limit')).toBe(true);
  expect(result.changedCount).toBeGreaterThan(0);
});
