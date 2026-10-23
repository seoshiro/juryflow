export interface Judge { id: string; name: string; expertise: string; availableSlots: number[] }
export interface Room { id: string; name: string; availableSlots: number[] }
export interface Team { id: string; name: string; track: string; availableSlots: number[]; requiredJudgeIds: string[]; excludedJudgeIds: string[]; judgeCount: number }
export interface Assignment { teamId: string; slot: number; roomId: string; judgeIds: string[] }
export interface Project { id: string; name: string; date: string; startTime: string; slotMinutes: number; slotCount: number; teams: Team[]; judges: Judge[]; rooms: Room[]; locks: Assignment[] }
export interface Issue { code: string; message: string; teamIds?: string[] }
export interface SolveOptions { previous?: Assignment[]; timeBudgetMs?: number; maxNodes?: number; shouldCancel?: () => boolean }
export interface SolveResult { status: 'feasible' | 'infeasible' | 'unknown' | 'cancelled'; assignments: Assignment[]; issues: Issue[]; nodes: number; elapsedMs: number; changedCount: number; preferenceProven: boolean }
export interface SavedDocument { schemaVersion: 1; project: Project; schedule: Assignment[]; baseline: Assignment[]; language: 'en' | 'ru' }
export interface WorkerRequest { id: number; project: Project; previous?: Assignment[] }
export interface WorkerResponse { id: number; result?: SolveResult; error?: string }
