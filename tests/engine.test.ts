import { describe, expect, it } from 'vitest';
import { solve, validateProject, validateSchedule } from '../src/engine';
import type { Assignment, Project } from '../src/types';

function fixture(): Project {
  return {
    id: 'test', name: 'Test pitches', date: '2026-10-23', startTime: '09:00', slotMinutes: 15, slotCount: 3,
    teams: ['a', 'b', 'c'].map(id => ({ id, name: `Team ${id}`, track: 'Test', availableSlots: [0, 1, 2], requiredJudgeIds: [], excludedJudgeIds: [], judgeCount: 1 })),
    judges: ['j1', 'j2'].map(id => ({ id, name: id, expertise: '', availableSlots: [0, 1, 2] })),
    rooms: ['r1', 'r2'].map(id => ({ id, name: id, availableSlots: [0, 1, 2] })), locks: [],
  };
}
const a = (teamId: string, slot = 0, roomId = 'r1', judgeIds = ['j1']): Assignment => ({ teamId, slot, roomId, judgeIds });
const codes = (project: Project, schedule: Assignment[]) => validateSchedule(project, schedule).map(value => value.code);
const generous = { timeBudgetMs: 10_000, maxNodes: 5_000_000 };

describe('hard constraints', () => {
  it('builds a complete valid schedule and never mutates inputs', () => {
    const project = fixture();
    const original = JSON.stringify(project);
    const result = solve(project);
    expect(result.status).toBe('feasible');
    expect(result.assignments).toHaveLength(3);
    expect(validateSchedule(project, result.assignments)).toEqual([]);
    expect(JSON.stringify(project)).toBe(original);
  });
  it('has deterministic assignments and node count', () => {
    const project = fixture();
    const first = solve(project, generous);
    const second = solve(structuredClone(project), generous);
    expect(second.assignments).toEqual(first.assignments);
    expect(second.nodes).toBe(first.nodes);
  });
  it('enforces team, room and judge availability together', () => {
    const project = fixture();
    project.teams[0].availableSlots = [2];
    project.teams[0].requiredJudgeIds = ['j2'];
    project.judges[1].availableSlots = [1, 2];
    project.rooms[0].availableSlots = [0, 1];
    const result = solve(project);
    expect(result.status).toBe('feasible');
    expect(result.assignments.find(value => value.teamId === 'a')).toEqual(a('a', 2, 'r2', ['j2']));
    expect(validateSchedule(project, result.assignments)).toEqual([]);
  });
  it('supports multiple judges, required judges and conflicts of interest', () => {
    const project = fixture();
    project.judges.push({ id: 'j3', name: 'j3', expertise: '', availableSlots: [0, 1, 2] });
    project.teams[0].judgeCount = 2;
    project.teams[0].requiredJudgeIds = ['j2'];
    project.teams[0].excludedJudgeIds = ['j1'];
    const result = solve(project);
    expect(result.status).toBe('feasible');
    expect(result.assignments.find(value => value.teamId === 'a')?.judgeIds).toEqual(['j2', 'j3']);
    expect(validateSchedule(project, result.assignments)).toEqual([]);
  });
  it('honours locked assignments exactly, including judge panel', () => {
    const project = fixture();
    project.locks = [a('b', 2, 'r2', ['j2'])];
    const result = solve(project);
    expect(result.status).toBe('feasible');
    expect(result.assignments.find(value => value.teamId === 'b')).toEqual(project.locks[0]);
    expect(validateSchedule(project, result.assignments)).toEqual([]);
  });
  it('recognizes insufficient room capacity with an actionable explanation', () => {
    const project = fixture();
    project.rooms = [{ id: 'r1', name: 'r1', availableSlots: [0] }];
    const result = solve(project);
    expect(result.status).toBe('infeasible');
    expect(result.issues.some(value => value.code === 'room-capacity')).toBe(true);
  });
  it('recognizes insufficient judge capacity', () => {
    const project = fixture();
    project.judges.forEach(judge => { judge.availableSlots = [0]; });
    expect(solve(project).issues.some(value => value.code === 'judge-capacity')).toBe(true);
  });
  it('recognizes unsatisfiable overlap after exhaustive search', () => {
    const project = fixture();
    project.teams.forEach(team => { team.availableSlots = [0]; });
    const result = solve(project, generous);
    expect(result.status).toBe('infeasible');
    expect(result.issues[0].code).toBe('search-exhausted');
    expect(result.issues[0].message).toContain('not a minimal');
  });
  it('recognizes no valid panel before search', () => {
    const project = fixture();
    project.teams[0].excludedJudgeIds = ['j1', 'j2'];
    expect(solve(project).issues[0].code).toBe('no-placement');
  });
  it('handles an empty event without inventing assignments', () => {
    const project = fixture();
    project.teams = [];
    expect(solve(project).assignments).toEqual([]);
    expect(solve(project).status).toBe('feasible');
  });
});

describe('validation and invalid locks', () => {
  it('rejects missing teams, duplicate teams and unknown entities', () => {
    const project = fixture();
    expect(codes(project, [a('a')])).toContain('missing-team');
    expect(codes(project, [a('a'), a('a', 1)])).toContain('duplicate-team');
    expect(codes(project, [a('unknown')])).toContain('unknown-team');
    expect(codes(project, [a('a', 0, 'unknown', ['unknown'])])).toEqual(expect.arrayContaining(['unknown-room', 'unknown-judge']));
  });
  it('rejects simultaneous room and judge overlap independently', () => {
    const project = fixture();
    expect(codes(project, [a('a'), a('b', 0, 'r2')])).toContain('judge-overlap');
    expect(codes(project, [a('a'), a('b', 0, 'r1', ['j2'])])).toContain('room-overlap');
  });
  it('rejects an unavailable team, room, judge and invalid slot', () => {
    const project = fixture();
    project.teams[0].availableSlots = [1];
    project.rooms[0].availableSlots = [1];
    project.judges[0].availableSlots = [1];
    expect(codes(project, [a('a')])).toEqual(expect.arrayContaining(['team-unavailable', 'room-unavailable', 'judge-unavailable']));
    expect(codes(fixture(), [a('a', 3)])).toContain('invalid-assignment-slot');
  });
  it('rejects wrong or duplicate panel members', () => {
    expect(codes(fixture(), [a('a', 0, 'r1', [])])).toContain('invalid-panel');
    const project = fixture();
    project.teams[0].judgeCount = 2;
    expect(codes(project, [a('a', 0, 'r1', ['j1', 'j1'])])).toContain('invalid-panel');
  });
  it('rejects a missing required judge and conflict of interest', () => {
    const project = fixture();
    project.teams[0].requiredJudgeIds = ['j2'];
    project.teams[0].excludedJudgeIds = ['j1'];
    expect(codes(project, [a('a')])).toEqual(expect.arrayContaining(['required-judge', 'conflict-of-interest']));
  });
  it.each([
    ['unknown-room', a('a', 0, 'unknown')],
    ['invalid-assignment-slot', a('a', 99)],
    ['invalid-panel', a('a', 0, 'r1', [])],
    ['unknown-judge', a('a', 0, 'r1', ['unknown'])],
    ['unknown-team', a('unknown')],
  ])('rejects invalid lock: %s', (code, lock) => {
    const project = fixture();
    project.locks = [lock as Assignment];
    const result = solve(project);
    expect(result.status).toBe('infeasible');
    expect(result.assignments).toEqual([]);
    expect(result.issues.map(value => value.code)).toContain(code);
  });
  it('rejects conflicting locks and duplicate team locks', () => {
    const project = fixture();
    project.locks = [a('a'), a('b')];
    expect(solve(project).issues.map(value => value.code)).toEqual(expect.arrayContaining(['room-overlap', 'judge-overlap']));
    project.locks = [a('a'), a('a', 1)];
    expect(solve(project).issues.map(value => value.code)).toContain('duplicate-team');
  });
  it('rejects an unavailable locked judge rather than silently unlocking', () => {
    const project = fixture();
    project.locks = [a('a')];
    project.judges[0].availableSlots = [1, 2];
    const result = solve(project);
    expect(result.status).toBe('infeasible');
    expect(result.issues.map(value => value.code)).toContain('judge-unavailable');
  });
  it('checks locks against externally supplied complete schedules', () => {
    const project = fixture();
    const result = solve(project);
    project.locks = [a('a', 2, 'r2', ['j2'])];
    expect(codes(project, result.assignments)).toContain('lock-changed');
  });
  it('rejects contradictory, duplicate and nonexistent judge references', () => {
    const project = fixture();
    project.teams[0].requiredJudgeIds = ['j1'];
    project.teams[0].excludedJudgeIds = ['j1'];
    expect(validateProject(project).map(value => value.code)).toContain('contradictory-judges');
    project.teams[0].requiredJudgeIds = ['j1', 'j1'];
    expect(validateProject(project).map(value => value.code)).toContain('invalid-team');
    project.teams[0].requiredJudgeIds = ['unknown'];
    expect(validateProject(project).map(value => value.code)).toContain('unknown-judge');
  });
  it('rejects malformed input without throwing', () => {
    for (const value of [null, {}, { ...fixture(), teams: [null] }, { ...fixture(), rooms: 'invalid' }, { ...fixture(), locks: [null] }, { ...fixture(), date: '2026-02-31' }, { ...fixture(), slotCount: 33 }]) {
      expect(() => validateProject(value as unknown as Project)).not.toThrow();
      expect(validateProject(value as unknown as Project).length).toBeGreaterThan(0);
    }
    expect(codes(fixture(), [null as unknown as Assignment])).toContain('invalid-assignment');
  });
});

describe('bounded search and disruption preference', () => {
  it('returns unknown, not infeasible, on zero time or node budget', () => {
    expect(solve(fixture(), { timeBudgetMs: 0 }).status).toBe('unknown');
    expect(solve(fixture(), { maxNodes: 0 }).status).toBe('unknown');
    const result = solve(fixture(), { maxNodes: 4 });
    expect(result.status).toBe('unknown');
    expect(result.nodes).toBeLessThanOrEqual(4);
  });
  it('checks cancellation during candidate generation', () => {
    let checks = 0;
    const result = solve(fixture(), { shouldCancel: () => ++checks > 5 });
    expect(result.status).toBe('cancelled');
    expect(result.assignments).toEqual([]);
  });
  it('normalizes NaN budgets instead of silently disabling limits', () => {
    const result = solve(fixture(), { timeBudgetMs: Number.NaN, maxNodes: Number.NaN });
    expect(result.status).toBe('feasible');
    expect(result.nodes).toBeLessThanOrEqual(250_000);
  });
  it('rejects control characters in IDs used for occupancy and equality keys', () => {
    const project = fixture();
    project.teams[0].id = 'a\0b';
    expect(validateProject(project).map(value => value.code)).toContain('invalid-entity');
  });
  it('preserves a still-valid schedule with a zero-change proof', () => {
    const project = fixture();
    const previous = solve(project).assignments;
    const result = solve(project, { previous });
    expect(result.assignments).toEqual(previous);
    expect(result.changedCount).toBe(0);
    expect(result.preferenceProven).toBe(true);
  });
  it('replans after judge availability changes and preserves unaffected teams', () => {
    const project = fixture();
    const previous = [a('a'), a('b', 0, 'r2', ['j2']), a('c', 1)];
    expect(validateSchedule(project, previous)).toEqual([]);
    project.judges[0].availableSlots = [0];
    const result = solve(project, { previous, ...generous });
    expect(result.status).toBe('feasible');
    expect(validateSchedule(project, result.assignments)).toEqual([]);
    expect(result.changedCount).toBe(1);
    expect(result.preferenceProven).toBe(true);
    expect(result.assignments.find(value => value.teamId === 'a')).toEqual(previous[0]);
    expect(result.assignments.find(value => value.teamId === 'b')).toEqual(previous[1]);
    expect(result.assignments.find(value => value.teamId === 'c')?.judgeIds).toEqual(['j2']);
  });
  it('never returns the previous schedule when it violates a current lock', () => {
    const project = fixture();
    const previous = solve(project).assignments;
    project.locks = [a('a', 2, 'r2', ['j2'])];
    const result = solve(project, { previous, ...generous });
    expect(result.assignments.find(value => value.teamId === 'a')).toEqual(project.locks[0]);
    expect(validateSchedule(project, result.assignments)).toEqual([]);
  });
});

/** Independent tiny oracle: enumerate placements and resource use without calling engine validators. */
function bruteForce(project: Project): boolean {
  const usedRooms = new Set<string>();
  const usedJudges = new Set<string>();
  function walk(index: number): boolean {
    if (index === project.teams.length) return true;
    const team = project.teams[index];
    for (const slot of team.availableSlots) for (const room of project.rooms) for (const judge of project.judges) {
      if (!room.availableSlots.includes(slot) || !judge.availableSlots.includes(slot) || team.excludedJudgeIds.includes(judge.id) || (team.requiredJudgeIds.length > 0 && !team.requiredJudgeIds.includes(judge.id))) continue;
      const roomKey = `${room.id}:${slot}`;
      const judgeKey = `${judge.id}:${slot}`;
      if (usedRooms.has(roomKey) || usedJudges.has(judgeKey)) continue;
      usedRooms.add(roomKey); usedJudges.add(judgeKey);
      if (walk(index + 1)) return true;
      usedRooms.delete(roomKey); usedJudges.delete(judgeKey);
    }
    return false;
  }
  return walk(0);
}

it('agrees with an independent exhaustive oracle on 120 seeded small adversarial events', () => {
  let seed = 719;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 120; i++) {
    const project = fixture();
    for (const entity of [...project.teams, ...project.judges, ...project.rooms]) entity.availableSlots = [0, 1, 2].filter(() => random() > 0.4);
    for (const team of project.teams) {
      const rule = random();
      if (rule > 0.65) team.requiredJudgeIds = [random() > 0.5 ? 'j1' : 'j2'];
      else if (rule > 0.4) team.excludedJudgeIds = [random() > 0.5 ? 'j1' : 'j2'];
    }
    const expected = bruteForce(project);
    const result = solve(project, generous);
    expect(result.status, `seeded event ${i}`).toBe(expected ? 'feasible' : 'infeasible');
    if (expected) expect(validateSchedule(project, result.assignments)).toEqual([]);
  }
});
