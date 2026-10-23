import { describe, expect, it } from 'vitest';
import { sameAssignment, sameJudgeIds } from '../src/assignment';

describe('assignment equality', () => {
  it('does not collide for valid comma-containing IDs', () => {
    expect(sameJudgeIds(['a', 'b,c'], ['a,b', 'c'])).toBe(false);
    expect(sameJudgeIds(['a,b', 'c'], ['c', 'a,b'])).toBe(true);
  });
  it('compares arrays without delimiter collisions or mutation', () => {
    const panel = ['z', 'a'];
    expect(sameJudgeIds(panel, ['a', 'z'])).toBe(true);
    expect(panel).toEqual(['z', 'a']);
    expect(sameJudgeIds(['a', 'a'], ['a'])).toBe(false);
    expect(sameJudgeIds(['a\u0000b', 'c'], ['a', 'b\u0000c'])).toBe(false);
  });
  it('includes team, slot, room and the unordered panel', () => {
    const a = { teamId: 't', slot: 0, roomId: 'r', judgeIds: ['a', 'b,c'] };
    expect(sameAssignment(a, { ...a, judgeIds: ['b,c', 'a'] })).toBe(true);
    for (const b of [{ ...a, slot: 1 }, { ...a, teamId: 'u' }, { ...a, roomId: 's' }, { ...a, judgeIds: ['a,b', 'c'] }]) expect(sameAssignment(a, b)).toBe(false);
  });
});
