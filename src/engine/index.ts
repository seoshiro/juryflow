import type { Assignment, Issue, Project, SolveOptions, SolveResult, Team } from '../types';
import { sameAssignment as same } from '../assignment';

const LIMITS = { teams: 60, judges: 12, rooms: 8, slots: 32 };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasControl = (value: string) => Array.from(value).some(character => { const code = character.charCodeAt(0); return code < 32 || (code >= 127 && code <= 159); });
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && !hasControl(value);
const optionalText = (value: unknown) => typeof value === 'string' && value.length <= 160 && !hasControl(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const unique = <T,>(values: T[]) => new Set(values).size === values.length;
const issue = (code: string, message: string, teamIds?: string[]): Issue => ({ code, message, ...(teamIds ? { teamIds } : {}) });

function dataArray(value: unknown, max: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return false;
  }
  return true;
}

/** Validate structural input and locked assignments before any search. Limits bound browser work. */
export function validateProject(project: Project): Issue[] {
  const p: unknown = project;
  if (!record(p)) return [issue('invalid-project', 'The event must be an object.')];
  const issues: Issue[] = [];
  if (!text(p.id) || !text(p.name)) issues.push(issue('invalid-project', 'Event ID and name must be non-empty text (up to 160 characters).'));
  if (typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || Number.isNaN(Date.parse(`${p.date}T00:00:00Z`)) || new Date(`${p.date}T00:00:00Z`).toISOString().slice(0, 10) !== p.date) issues.push(issue('invalid-date', 'Use a valid event date in YYYY-MM-DD format.'));
  if (typeof p.startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.startTime)) issues.push(issue('invalid-time', 'Start time must be a valid HH:MM time in UTC.'));
  if (!integer(p.slotMinutes) || p.slotMinutes < 5 || p.slotMinutes > 120) issues.push(issue('invalid-duration', 'Slot duration must be between 5 and 120 whole minutes.'));
  if (!integer(p.slotCount) || p.slotCount < 1 || p.slotCount > LIMITS.slots) issues.push(issue('invalid-slots', `Use between 1 and ${LIMITS.slots} slots.`));
  for (const [key, max] of [['teams', LIMITS.teams], ['judges', LIMITS.judges], ['rooms', LIMITS.rooms], ['locks', LIMITS.teams]] as const) {
    if (!dataArray(p[key], max)) issues.push(issue('invalid-project', `${key} must be a dense data array with at most ${max} entries.`));
  }
  if (issues.length) return issues;
  const slotCount = project.slotCount;
  const availability = (value: unknown) => dataArray(value, slotCount) && unique(value) && value.every(slot => integer(slot) && slot >= 0 && slot < slotCount);
  const idList = (value: unknown) => dataArray(value, LIMITS.judges) && unique(value) && value.every(text);
  for (const key of ['teams', 'judges', 'rooms'] as const) {
    const values = project[key] as unknown[];
    const ids = new Set<string>();
    values.forEach((value, index) => {
      if (!record(value) || !text(value.id) || !text(value.name)) { issues.push(issue('invalid-entity', `${key}[${index}] needs a valid ID and name.`)); return; }
      const id = value.id as string;
      if (ids.has(id)) issues.push(issue('duplicate-id', `Duplicate ${key} ID: ${id}.`));
      ids.add(id);
      if (!availability(value.availableSlots)) issues.push(issue('invalid-availability', `${value.name} has invalid or duplicate availability slots.`));
      if (key === 'judges' && !optionalText(value.expertise)) issues.push(issue('invalid-entity', `${value.name} needs an expertise field (up to 160 characters).`));
      if (key === 'teams') {
        if (!optionalText(value.track) || !integer(value.judgeCount) || value.judgeCount < 1 || value.judgeCount > LIMITS.judges || !idList(value.requiredJudgeIds) || !idList(value.excludedJudgeIds)) issues.push(issue('invalid-team', `${value.name} needs a valid track, judge count, and unique judge rule lists.`));
      }
    });
  }
  if (issues.length) return issues;
  const judges = new Set(project.judges.map(judge => judge.id));
  for (const team of project.teams) {
    for (const id of [...team.requiredJudgeIds, ...team.excludedJudgeIds]) if (!judges.has(id)) issues.push(issue('unknown-judge', `${team.name} references an unknown judge: ${id}.`, [team.id]));
    if (team.requiredJudgeIds.some(id => team.excludedJudgeIds.includes(id))) issues.push(issue('contradictory-judges', `${team.name} both requires and excludes the same judge.`, [team.id]));
    if (team.requiredJudgeIds.length > team.judgeCount) issues.push(issue('too-many-required', `${team.name} requires more judges than its panel size.`, [team.id]));
  }
  if (issues.length) return issues;
  return assignmentIssues(project, project.locks, false, false);
}

function assignmentIssues(project: Project, assignments: Assignment[], complete: boolean, enforceLocks: boolean): Issue[] {
  const issues: Issue[] = [];
  if (!dataArray(assignments, LIMITS.teams)) return [issue('invalid-assignments', `Assignments must be a dense data array with at most ${LIMITS.teams} entries.`)];
  const teams = new Map(project.teams.map(team => [team.id, team]));
  const judges = new Map(project.judges.map(judge => [judge.id, judge]));
  const rooms = new Map(project.rooms.map(room => [room.id, room]));
  const assigned = new Map<string, Assignment>();
  const roomUse = new Map<string, string>();
  const judgeUse = new Map<string, string>();
  for (const candidate of assignments) {
    const value: unknown = candidate;
    if (!record(value) || !text(value.teamId) || !text(value.roomId) || !integer(value.slot) || !dataArray(value.judgeIds, LIMITS.judges) || !value.judgeIds.every(text)) { issues.push(issue('invalid-assignment', 'Each assignment needs a team, slot, room and judge IDs.')); continue; }
    const a = candidate;
    const team = teams.get(a.teamId);
    const room = rooms.get(a.roomId);
    if (!team) { issues.push(issue('unknown-team', `Assignment references unknown team: ${a.teamId}.`)); continue; }
    if (assigned.has(a.teamId)) issues.push(issue('duplicate-team', `${team.name} is assigned more than once.`, [team.id]));
    assigned.set(a.teamId, a);
    if (a.slot < 0 || a.slot >= project.slotCount) issues.push(issue('invalid-assignment-slot', `${team.name} has a slot outside the event.`, [team.id]));
    if (!team.availableSlots.includes(a.slot)) issues.push(issue('team-unavailable', `${team.name} is unavailable in slot ${a.slot + 1}.`, [team.id]));
    if (!room) issues.push(issue('unknown-room', `${team.name} references unknown room: ${a.roomId}.`, [team.id]));
    else if (!room.availableSlots.includes(a.slot)) issues.push(issue('room-unavailable', `${room.name} is unavailable in slot ${a.slot + 1}.`, [team.id]));
    if (!unique(a.judgeIds) || a.judgeIds.length !== team.judgeCount) issues.push(issue('invalid-panel', `${team.name} needs exactly ${team.judgeCount} different judges.`, [team.id]));
    if (team.requiredJudgeIds.some(id => !a.judgeIds.includes(id))) issues.push(issue('required-judge', `${team.name} is missing a required judge.`, [team.id]));
    if (team.excludedJudgeIds.some(id => a.judgeIds.includes(id))) issues.push(issue('conflict-of-interest', `${team.name} has an excluded judge on its panel.`, [team.id]));
    const roomKey = `${a.slot}\0${a.roomId}`;
    const otherRoom = roomUse.get(roomKey);
    if (otherRoom) issues.push(issue('room-overlap', `${room?.name ?? a.roomId} is double-booked in slot ${a.slot + 1}.`, [otherRoom, team.id]));
    roomUse.set(roomKey, team.id);
    for (const id of a.judgeIds) {
      const judge = judges.get(id);
      if (!judge) issues.push(issue('unknown-judge', `${team.name} references unknown judge: ${id}.`, [team.id]));
      else if (!judge.availableSlots.includes(a.slot)) issues.push(issue('judge-unavailable', `${judge.name} is unavailable for ${team.name} in slot ${a.slot + 1}.`, [team.id]));
      const key = `${a.slot}\0${id}`;
      const other = judgeUse.get(key);
      if (other && other !== team.id) issues.push(issue('judge-overlap', `${judge?.name ?? id} is double-booked in slot ${a.slot + 1}.`, [other, team.id]));
      judgeUse.set(key, team.id);
    }
  }
  if (complete) for (const team of project.teams) if (!assigned.has(team.id)) issues.push(issue('missing-team', `${team.name} has no assignment.`, [team.id]));
  if (enforceLocks) for (const lock of project.locks) {
    const actual = assigned.get(lock.teamId);
    if (!actual || !same(lock, actual)) issues.push(issue('lock-changed', `The locked assignment for ${teams.get(lock.teamId)?.name ?? lock.teamId} was changed.`, [lock.teamId]));
  }
  return issues;
}

/** Independently checks a complete schedule, including all hard constraints and locks. */
export function validateSchedule(project: Project, assignments: Assignment[]): Issue[] {
  const invalid = validateProject(project);
  return invalid.length ? invalid : assignmentIssues(project, assignments, true, true);
}

/** Deterministic finite-domain search. A limit without a solution means unknown, never infeasible. */
export function solve(project: Project, options: SolveOptions = {}): SolveResult {
  const started = performance.now();
  let nodes = 0;
  let halted: 'unknown' | 'cancelled' | undefined;
  const maxNodes = Number.isFinite(options.maxNodes) ? Math.max(0, Math.min(5_000_000, Math.floor(options.maxNodes!))) : 250_000;
  const budget = Number.isFinite(options.timeBudgetMs) ? Math.max(0, Math.min(10_000, options.timeBudgetMs!)) : 1200;
  const previous = new Map<string, Assignment>();
  const previousAssignments = Array.isArray(options.previous) ? options.previous.slice(0, LIMITS.teams) : [];
  for (const a of previousAssignments) if (a && text(a.teamId) && text(a.roomId) && integer(a.slot) && Array.isArray(a.judgeIds) && a.judgeIds.length <= LIMITS.judges && a.judgeIds.every(text)) previous.set(a.teamId, a);
  const hasPreference = previous.size > 0;
  const changed = (a: Assignment) => previous.has(a.teamId) && !same(previous.get(a.teamId)!, a) ? 1 : 0;
  const finish = (status: SolveResult['status'], assignments: Assignment[], issues: Issue[], preferenceProven = false): SolveResult => ({ status, assignments: assignments.map(a => ({ ...a, judgeIds: [...a.judgeIds] })), issues, nodes, elapsedMs: Math.round((performance.now() - started) * 100) / 100, changedCount: assignments.reduce((sum, a) => sum + changed(a), 0), preferenceProven });
  const invalid = validateProject(project);
  if (invalid.length) return finish('infeasible', [], invalid);
  const checkpoint = (increment = true) => {
    if (options.shouldCancel?.()) halted = 'cancelled';
    else if (nodes >= maxNodes || performance.now() - started >= budget) halted = 'unknown';
    else if (increment) nodes++;
    return !halted;
  };
  if (!checkpoint(false)) return finish(halted!, [], [issue(halted === 'cancelled' ? 'cancelled' : 'search-limit', halted === 'cancelled' ? 'Search was cancelled.' : 'Search limit reached. Feasibility is unknown.')]);
  if (project.teams.length === 0) return finish('feasible', [], [], true);
  const necessary: Issue[] = [];
  if (project.rooms.reduce((sum, room) => sum + room.availableSlots.length, 0) < project.teams.length) necessary.push(issue('room-capacity', 'There are fewer available room-slots than teams. Add slots or rooms, or widen room availability.'));
  if (project.judges.reduce((sum, judge) => sum + judge.availableSlots.length, 0) < project.teams.reduce((sum, team) => sum + team.judgeCount, 0)) necessary.push(issue('judge-capacity', 'Available judge-slots are fewer than the required panel places. Add availability, slots or judges.'));
  for (const judge of project.judges) {
    const demand = project.teams.filter(team => team.requiredJudgeIds.includes(judge.id));
    if (demand.length > judge.availableSlots.length) necessary.push(issue('required-judge-capacity', `${judge.name} is required by ${demand.length} teams but available for only ${judge.availableSlots.length} slots.`, demand.map(team => team.id)));
  }
  if (necessary.length) return finish('infeasible', [], necessary);
  if (hasPreference && validateSchedule(project, previousAssignments).length === 0) return finish('feasible', previousAssignments, [], true);

  const roomUse = new Set<string>();
  const judgeUse = new Set<string>();
  const assigned = new Map<string, Assignment>();
  const place = (a: Assignment, add: boolean) => {
    const room = `${a.slot}\0${a.roomId}`;
    if (add) { roomUse.add(room); assigned.set(a.teamId, a); } else { roomUse.delete(room); assigned.delete(a.teamId); }
    for (const id of a.judgeIds) { const key = `${a.slot}\0${id}`; if (add) judgeUse.add(key); else judgeUse.delete(key); }
  };
  const compatible = (a: Assignment) => !roomUse.has(`${a.slot}\0${a.roomId}`) && a.judgeIds.every(id => !judgeUse.has(`${a.slot}\0${id}`));
  for (const lock of project.locks) place(lock, true);
  const domains = new Map<string, Assignment[]>();
  const teams = project.teams.filter(team => !assigned.has(team.id)).sort((a, b) => compare(a.id, b.id));
  const rooms = [...project.rooms].sort((a, b) => compare(a.id, b.id));
  const judges = [...project.judges].sort((a, b) => compare(a.id, b.id));
  const domainFor = (team: Team) => {
    const domain: Assignment[] = [];
    for (const slot of [...team.availableSlots].sort((a, b) => a - b)) {
      if (!checkpoint()) break;
      const eligible = judges.filter(judge => judge.availableSlots.includes(slot) && !team.excludedJudgeIds.includes(judge.id)).map(judge => judge.id);
      const required = [...team.requiredJudgeIds].sort(compare);
      if (required.some(id => !eligible.includes(id))) continue;
      const optional = eligible.filter(id => !required.includes(id));
      const count = team.judgeCount - required.length;
      if (count > optional.length) continue;
      const availableRooms = rooms.filter(room => room.availableSlots.includes(slot));
      const choose = (from: number, chosen: string[]) => {
        if (!checkpoint()) return;
        if (chosen.length === count) {
          for (const room of availableRooms) {
            if (!checkpoint()) return;
            const a = { teamId: team.id, slot, roomId: room.id, judgeIds: [...required, ...chosen].sort(compare) };
            if (compatible(a)) domain.push(a);
          }
          return;
        }
        for (let i = from; i <= optional.length - (count - chosen.length); i++) { choose(i + 1, [...chosen, optional[i]]); if (halted) return; }
      };
      choose(0, []);
      if (halted) break;
    }
    const prior = previous.get(team.id);
    domain.sort((a, b) => changed(a) - changed(b) || (prior ? Math.abs(a.slot - prior.slot) - Math.abs(b.slot - prior.slot) || Number(a.roomId !== prior.roomId) - Number(b.roomId !== prior.roomId) : 0) || a.slot - b.slot || compare(a.roomId, b.roomId) || compare(a.judgeIds.join('\0'), b.judgeIds.join('\0')));
    return domain;
  };
  for (const team of teams) {
    const domain = domainFor(team);
    if (halted) return finish(halted, [], [issue(halted === 'cancelled' ? 'cancelled' : 'search-limit', halted === 'cancelled' ? 'Search was cancelled.' : 'Search limit reached while preparing placements. Feasibility is unknown.')]);
    if (!domain.length) return finish('infeasible', [], [issue('no-placement', `${team.name} has no placement satisfying availability, panel rules, rooms and locked assignments. Review these constraints.`, [team.id])]);
    domains.set(team.id, domain);
  }
  let best: Assignment[] | undefined;
  let bestCost = Number.POSITIVE_INFINITY;
  let zeroProven = false;
  const search = (remaining: Team[], cost: number): boolean => {
    if (!checkpoint()) return true;
    if (!remaining.length) {
      best = project.teams.map(team => assigned.get(team.id)!);
      bestCost = cost;
      zeroProven = cost === 0;
      return !hasPreference || zeroProven;
    }
    let chosen: Team | undefined;
    let candidates: Assignment[] = [];
    let lowerBound = cost;
    for (const team of remaining) {
      const viable: Assignment[] = [];
      let preserves = !previous.has(team.id);
      for (const a of domains.get(team.id)!) {
        if (!checkpoint()) return true;
        if (compatible(a)) { viable.push(a); if (changed(a) === 0) preserves = true; }
      }
      if (!viable.length) return false;
      if (!preserves) lowerBound++;
      if (!chosen || viable.length < candidates.length) { chosen = team; candidates = viable; }
    }
    if (lowerBound >= bestCost) return false;
    const next = remaining.filter(team => team !== chosen);
    for (const a of candidates) {
      if (cost + changed(a) >= bestCost) continue;
      place(a, true);
      const stop = search(next, cost + changed(a));
      place(a, false);
      if (stop) return true;
    }
    return false;
  };
  search(teams, project.locks.reduce((sum, a) => sum + changed(a), 0));
  if (halted === 'cancelled') return finish('cancelled', [], [issue('cancelled', 'Search was cancelled.')]);
  if (best) return finish('feasible', best, halted ? [issue('preference-limit', 'A valid schedule was found. The disruption search reached its limit; a lower-disruption schedule may exist.')] : [], hasPreference ? zeroProven || !halted : false);
  if (halted) return finish('unknown', [], [issue('search-limit', 'Search limit reached without a complete schedule. Feasibility is unknown; simplify constraints or try a larger search budget.')]);
  return finish('infeasible', [], [issue('search-exhausted', 'No complete schedule satisfies all current constraints. The search exhausted all valid placements. Review availability, panel rules and locks; this explanation is not a minimal conflict set.')]);
}
