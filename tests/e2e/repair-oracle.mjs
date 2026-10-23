// Original independent audit oracle body; runtime adaptation is isolated in oracle-runtime.mjs.
import { fs, path, out, solve, validateSchedule, parseDocument, restoreDraft, serializeDocument, exportICS, slotLabel } from "./oracle-runtime.mjs";
let seed=0x90ad51;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/2**32;};
const int=n=>Math.floor(random()*n);
const equal=(a,b)=>a.teamId===b.teamId&&a.slot===b.slot&&a.roomId===b.roomId&&JSON.stringify([...a.judgeIds].sort())===JSON.stringify([...b.judgeIds].sort());
function fixture(n=3,j=3,r=2,s=3){
  const slots=Array.from({length:s},(_,i)=>i);
  return {id:'audit',name:'Synthetic Audit',date:'2026-10-23',startTime:'23:45',slotMinutes:15,slotCount:s,teams:Array.from({length:n},(_,i)=>({id:'t'+i,name:'Team '+i,track:'audit',availableSlots:[...slots],requiredJudgeIds:[],excludedJudgeIds:[],judgeCount:1})),judges:Array.from({length:j},(_,i)=>({id:'j'+i,name:'Judge '+i,expertise:'',availableSlots:[...slots]})),rooms:Array.from({length:r},(_,i)=>({id:'r'+i,name:'Room '+i,availableSlots:[...slots]})),locks:[]};
}
function choose(xs,n){if(n===0)return [[]];if(n>xs.length)return [];return xs.flatMap((x,i)=>choose(xs.slice(i+1),n-1).map(ys=>[x,...ys]));}
function placements(p,t){
  return t.availableSlots.flatMap(slot=>p.rooms.filter(r=>r.availableSlots.includes(slot)).flatMap(r=>choose(p.judges.filter(j=>j.availableSlots.includes(slot)&&!t.excludedJudgeIds.includes(j.id)).map(j=>j.id),t.judgeCount).filter(js=>t.requiredJudgeIds.every(id=>js.includes(id))).map(js=>({teamId:t.id,slot,roomId:r.id,judgeIds:js}))));
}
function oracle(p,previous=[]){
  const prior=new Map(previous.map(a=>[a.teamId,a]));let best=Infinity,bestSchedule=[];
  const domains=p.teams.map(t=>{const lock=p.locks.find(a=>a.teamId===t.id);return placements(p,t).filter(a=>!lock||equal(a,lock));});
  const usedR=new Set(),usedJ=new Set(),chosen=[];
  function walk(index,cost){
    if(cost>=best)return;
    if(index===p.teams.length){best=cost;bestSchedule=structuredClone(chosen);return;}
    for(const a of domains[index]){
      const rk=JSON.stringify([a.slot,a.roomId]),jks=a.judgeIds.map(id=>JSON.stringify([a.slot,id]));
      if(usedR.has(rk)||jks.some(k=>usedJ.has(k)))continue;
      usedR.add(rk);jks.forEach(k=>usedJ.add(k));chosen.push(a);
      walk(index+1,cost+(prior.has(a.teamId)&&!equal(a,prior.get(a.teamId))?1:0));
      chosen.pop();usedR.delete(rk);jks.forEach(k=>usedJ.delete(k));
    }
  }
  walk(0,0);return {feasible:best!==Infinity,cost:best,schedule:bestSchedule};
}
const results={seed:'0x90ad51',oracleCases:0,replanCases:0,multiJudgeCases:0,lockCases:0,deterministicCases:0,failures:[],checks:[]};
const generous={timeBudgetMs:10000,maxNodes:5000000};
function assert(ok,label,data){if(!ok)results.failures.push({label,...data});}
for(let i=0;i<800;i++){
  const p=fixture(1+int(4),2+int(3),1+int(2),1+int(3));
  for(const entity of [...p.teams,...p.judges,...p.rooms])entity.availableSlots=entity.availableSlots.filter(()=>random()>.22);
  for(const t of p.teams){t.judgeCount=1+int(Math.min(3,p.judges.length));const shuffled=[...p.judges].sort(()=>random()-.5);t.requiredJudgeIds=shuffled.slice(0,int(t.judgeCount+1)).map(j=>j.id);t.excludedJudgeIds=shuffled.slice(t.judgeCount).filter(()=>random()>.55).map(j=>j.id);}
  if(p.teams.some(t=>t.judgeCount>1))results.multiJudgeCases++;
  const initial=oracle(p);
  if(initial.feasible&&random()>.35){p.locks=initial.schedule.filter(()=>random()>.6);if(p.locks.length)results.lockCases++;}
  const original=JSON.stringify(p),expected=oracle(p),actual=solve(p,generous);results.oracleCases++;
  assert(actual.status===(expected.feasible?'feasible':'infeasible'),'feasibility',{i,p,expected,actual});
  assert(JSON.stringify(p)===original,'mutated-input',{i});
  if(actual.status==='feasible')assert(validateSchedule(p,actual.assignments).length===0,'invalid-engine-result',{i,p,actual});
  if(i%8===0){const second=solve(structuredClone(p),generous);results.deterministicCases++;assert(JSON.stringify(second.assignments)===JSON.stringify(actual.assignments)&&second.nodes===actual.nodes,'nondeterministic',{i,p,actual,second});}
  if(initial.feasible){
    const q=structuredClone(p);q.locks=[];for(const j of q.judges)if(random()>.65)j.availableSlots=j.availableSlots.filter(()=>random()>.25);
    const ref=oracle(q,initial.schedule),replan=solve(q,{...generous,previous:initial.schedule});results.replanCases++;
    assert(replan.status===(ref.feasible?'feasible':'infeasible'),'replan-feasibility',{i,q,ref,replan});
    if(ref.feasible){assert(replan.changedCount===ref.cost,'replan-minimum-cost',{i,q,ref,replan});assert(replan.preferenceProven,'unproved-tiny-replan',{i,q,ref,replan});}
  }
}
const p=fixture();
for(const option of [{maxNodes:0},{timeBudgetMs:0},{maxNodes:4}]){const r=solve(p,option);assert(r.status==='unknown','limits-return-unknown',{option,r});}
for(const stopAt of [1,5,25,150]){let checks=0;const r=solve(p,{shouldCancel:()=>++checks>=stopAt});assert(r.status==='cancelled'||checks<stopAt,'cancellation',{stopAt,r,checks});}
const valid=solve(p,generous).assignments;
for(const [name,mutate] of [
 ['judge-overlap',a=>{a[1].slot=a[0].slot;a[1].judgeIds=[...a[0].judgeIds];a[1].roomId='r1';}],
 ['room-overlap',a=>{a[1].slot=a[0].slot;a[1].roomId=a[0].roomId;}],
 ['duplicate-team',a=>a.push(structuredClone(a[0]))],
 ['missing-team',a=>a.pop()],
 ['invalid-panel',a=>a[0].judgeIds=[]],
 ['unknown-room',a=>a[0].roomId='missing']
]){const a=structuredClone(valid);mutate(a);assert(validateSchedule(p,a).some(x=>x.code===name),'validator-'+name,{a});}
const invalidLocks=[{teamId:'t0',slot:0,roomId:'r0',judgeIds:[]},{teamId:'missing',slot:0,roomId:'r0',judgeIds:['j0']},{teamId:'t0',slot:9,roomId:'r0',judgeIds:['j0']}];
for(const lock of invalidLocks){const q=structuredClone(p);q.locks=[lock];assert(solve(q).status==='infeasible','invalid-lock',{lock});}
const ics=exportICS(p,valid);assert(ics.includes('DTSTART:20261024T000000Z'),'midnight-utc',{ics});
assert(slotLabel(p,2)==='00:15 +1d','midnight-label',{});
const doc={schemaVersion:1,project:p,schedule:valid,baseline:valid,language:'en'};
assert(parseDocument(serializeDocument(doc)).ok,'roundtrip',{});
assert(!parseDocument(' '.repeat(2000001)).ok,'oversize-import',{});
for(const malformed of ['null','[]','{}','{','{"schemaVersion":2}'])assert(!parseDocument(malformed).ok,'malformed-import',{malformed});
const invalid=structuredClone(doc);invalid.schedule[0].roomId='missing';assert(!parseDocument(JSON.stringify(invalid)).ok,'stale-import-rejected',{});assert(restoreDraft(JSON.stringify(invalid)).ok&&restoreDraft(JSON.stringify(invalid)).value.schedule.length===0,'draft-stale-cleared',{});
const c=fixture(1,4,1,1);c.judges.forEach((j,i)=>j.id=['a','b,c','a,b','c'][i]);c.teams[0].judgeCount=2;c.teams[0].requiredJudgeIds=['a,b','c'];const current=[{teamId:'t0',slot:0,roomId:'r0',judgeIds:['a,b','c']}],baseline=[{teamId:'t0',slot:0,roomId:'r0',judgeIds:['a','b,c']}];
const collision={schemaVersion:1,project:c,schedule:current,baseline,language:'en'};assert(parseDocument(JSON.stringify(collision)).ok,'collision-fixture-importable',{});const cr=solve(c,{previous:baseline,...generous});results.checks.push({name:'comma panel collision',engineChangedCount:cr.changedCount,uiComparisonSaysChanged:[...current[0].judgeIds].sort().join()!==[...baseline[0].judgeIds].sort().join(),expectedChangedCount:1});fs.writeFileSync(path.join(out,'comma-panel-collision.json'),JSON.stringify(collision,null,2));
fs.writeFileSync(path.join(out,'oracle-results.json'),JSON.stringify(results,null,2));
fs.writeFileSync(path.join(out,'utc-example.ics'),ics);
console.log(JSON.stringify(results,null,2));
if(results.failures.length)process.exitCode=1;
