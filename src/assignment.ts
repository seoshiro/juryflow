import type { Assignment } from './types';

/** Compare panels element by element; delimiter-bearing IDs must remain distinct. */
export function sameJudgeIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, index) => id === right[index]);
}

export function sameAssignment(a: Assignment, b: Assignment): boolean {
  return a.teamId === b.teamId && a.slot === b.slot && a.roomId === b.roomId && sameJudgeIds(a.judgeIds, b.judgeIds);
}
