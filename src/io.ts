import type { Assignment, Project, SavedDocument } from './types';
import { validateSchedule } from './engine';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clean = (v: string) => !Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 160 && clean(v);
const integer = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && Number(v) >= lo && Number(v) <= hi;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 60 && v.every(text) && new Set(v).size === v.length;
function assignments(v: unknown): v is Assignment[] { return Array.isArray(v) && v.length <= 60 && v.every(a => record(a) && text(a.teamId) && integer(a.slot, 0, 31) && text(a.roomId) && ids(a.judgeIds)); }
function checkProject(p: unknown, draft = false): p is Project {
  const label = (v: unknown): v is string => draft ? typeof v === 'string' && v.length <= 160 && clean(v) : text(v);
  if (!record(p) || !text(p.id) || !label(p.name) || typeof p.date !== 'string' || !(draft && p.date === '') && !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || typeof p.startTime !== 'string' || !(draft && p.startTime === '') && !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.startTime) || !integer(p.slotMinutes, 5, 120) || !integer(p.slotCount, 1, 32)) return false;
  const parsedDate = new Date(`${p.date}T00:00:00Z`);
  if (!(draft && p.date === '') && (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== p.date)) return false;
  const slots = (v: unknown) => Array.isArray(v) && v.length <= Number(p.slotCount) && v.every(s => integer(s, 0, Number(p.slotCount) - 1)) && new Set(v).size === v.length;
  if (!Array.isArray(p.judges) || p.judges.length > 12 || !p.judges.every(j => record(j) && text(j.id) && label(j.name) && typeof j.expertise === 'string' && j.expertise.length <= 160 && clean(j.expertise) && slots(j.availableSlots))) return false;
  if (!Array.isArray(p.rooms) || p.rooms.length > 8 || !p.rooms.every(r => record(r) && text(r.id) && label(r.name) && slots(r.availableSlots))) return false;
  if (!Array.isArray(p.teams) || p.teams.length > 60 || !p.teams.every(t => record(t) && text(t.id) && label(t.name) && typeof t.track === 'string' && t.track.length <= 160 && clean(t.track) && slots(t.availableSlots) && ids(t.requiredJudgeIds) && ids(t.excludedJudgeIds) && integer(t.judgeCount, 1, 12))) return false;
  if (![p.teams, p.judges, p.rooms].every(list => new Set(list.map(x => x.id)).size === list.length)) return false;
  const judges = new Set(p.judges.map(j => j.id));
  if (!p.teams.every(t => [...t.requiredJudgeIds, ...t.excludedJudgeIds].every(id => judges.has(id)))) return false;
  if (!assignments(p.locks) || new Set(p.locks.map(a => a.teamId)).size !== p.locks.length) return false;
  const teams = new Set(p.teams.map(t => t.id)); const rooms = new Set(p.rooms.map(r => r.id));
  return p.locks.every(a => teams.has(a.teamId) && rooms.has(a.roomId) && a.slot < Number(p.slotCount) && a.judgeIds.every(id => judges.has(id)));
}
export function parseDocument(source: string): { ok: true; value: SavedDocument } | { ok: false; error: string } { return parse(source, false); }
/** Local editing can temporarily leave names/date/time blank. Never weakens the import boundary. */
export function restoreDraft(source: string): ReturnType<typeof parseDocument> { return parse(source, true); }
function parse(source: string, draft: boolean): ReturnType<typeof parseDocument> {
  try {
    if (source.length > 2_000_000) throw new Error('File exceeds the 2 MB limit.');
    const v: unknown = JSON.parse(source);
    if (!record(v) || v.schemaVersion !== 1) throw new Error('Unsupported document. Expected schemaVersion: 1.');
    if (!checkProject(v.project, draft)) throw new Error('Invalid event data. Check IDs, references, date, availability and limits (60 teams / 12 judges / 8 rooms / 32 slots).');
    if (!assignments(v.schedule) || !assignments(v.baseline) || (v.language !== 'en' && v.language !== 'ru')) throw new Error('Invalid schedule, baseline or language.');
    let schedule = v.schedule;
    if (schedule.length) { const issues = validateSchedule(v.project, schedule); if (issues.length) { if (draft) schedule = []; else throw new Error(`Stored schedule is invalid: ${issues[0].message}`); } }
    const project = structuredClone(v.project);
    return { ok: true, value: { schemaVersion: 1, project, schedule, baseline: v.baseline, language: v.language } };
  } catch (e) { return { ok: false, error: e instanceof SyntaxError ? 'This file is not valid JSON.' : e instanceof Error ? e.message : 'Unable to read this document.' }; }
}
export function serializeDocument(doc: SavedDocument): string { return JSON.stringify(doc, null, 2); }
export function slotLabel(project: Project, slot: number): string {
  const minutes = Number(project.startTime.slice(0, 2)) * 60 + Number(project.startTime.slice(3)) + slot * project.slotMinutes;
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}${minutes >= 1440 ? ` +${Math.floor(minutes / 1440)}d` : ''}`;
}
const escapeICS = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
function fold(line: string): string {
  const out: string[] = []; let part = ''; let bytes = 0;
  for (const ch of line) { const n = new TextEncoder().encode(ch).length; if (bytes + n > 74) { out.push(part); part = ' '; bytes = 1; } part += ch; bytes += n; }
  out.push(part); return out.join('\r\n');
}
export function exportICS(project: Project, schedule: Assignment[]): string {
  if (!schedule.length || validateSchedule(project, schedule).length) throw new Error('Generate a valid schedule before exporting.');
  const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JURYFLOW//Schedule 1.0//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const a of [...schedule].sort((a,b) => a.slot - b.slot || a.roomId.localeCompare(b.roomId))) {
    const team = project.teams.find(t => t.id === a.teamId)!;
    const date = new Date(`${project.date}T${project.startTime}:00Z`); date.setUTCMinutes(date.getUTCMinutes() + a.slot * project.slotMinutes);
    const end = new Date(date.getTime() + project.slotMinutes * 60_000);
    lines.push('BEGIN:VEVENT', `UID:${escapeICS(`${project.id}-${a.teamId}`)}@juryflow.app`, `DTSTAMP:${stamp(new Date(`${project.date}T00:00:00Z`))}`, `DTSTART:${stamp(date)}`, `DTEND:${stamp(end)}`, `SUMMARY:${escapeICS(team.name)}`, `LOCATION:${escapeICS(project.rooms.find(r => r.id === a.roomId)!.name)}`, `DESCRIPTION:${escapeICS(`${project.name}\nJudges: ${a.judgeIds.map(id => project.judges.find(j => j.id === id)!.name).join(', ')}\n${team.track}`)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR'); return lines.map(fold).join('\r\n') + '\r\n';
}
export function downloadText(name: string, value: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([value], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
