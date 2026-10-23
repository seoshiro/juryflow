import type { Project, SavedDocument } from './types';
export function demoProject(): Project {
  const all = Array.from({ length: 8 }, (_, i) => i);
  const names = ['Orbit Notes', 'Root & Rain', 'Signal Studio', 'Kindred Maps', 'Civic Lens', 'Second Bloom', 'Open Current', 'Fieldwork', 'Paper Bridge', 'Quiet Energy', 'Common Ground', 'Northstar'];
  const tracks = ['Learning', 'Climate', 'Creative tools', 'Community', 'Civic tech', 'Circular economy'];
  return {
    id: 'juryflow-demo', name: 'Frontier / Demo Day', date: '2026-11-14', startTime: '09:00', slotMinutes: 15, slotCount: 8,
    judges: [
      { id: 'judge-1', name: 'Alex Morgan', expertise: 'Product & strategy', availableSlots: [...all] },
      { id: 'judge-2', name: 'Sam Rivera', expertise: 'Engineering', availableSlots: [...all] },
      { id: 'judge-3', name: 'Robin Chen', expertise: 'Design & impact', availableSlots: [...all] },
    ],
    rooms: [{ id: 'room-a', name: 'Forum A', availableSlots: [...all] }, { id: 'room-b', name: 'Forum B', availableSlots: [...all] }],
    teams: names.map((name, i) => ({ id: `team-${i + 1}`, name, track: tracks[i % tracks.length], availableSlots: i === 10 ? [3,4,5,6,7] : [...all], requiredJudgeIds: i === 2 ? ['judge-1'] : i === 0 ? ['judge-3'] : [], excludedJudgeIds: i === 4 ? ['judge-2'] : [], judgeCount: 1 })),
    locks: [{ teamId: 'team-1', slot: 0, roomId: 'room-a', judgeIds: ['judge-3'] }],
  };
}
export function demoDocument(): SavedDocument { return { schemaVersion: 1, project: demoProject(), schedule: [], baseline: [], language: 'en' }; }
