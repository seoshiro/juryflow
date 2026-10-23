import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import os from 'node:os';

const reposRoot = path.resolve(process.env.AUDIT_REPOS_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-independent-audit-'));
const compiled = new Set();
function compile(repo, from) {
  const key = `${repo}/${from}`;
  if (compiled.has(key)) return;
  compiled.add(key);
  const source = path.join(reposRoot, repo);
  let code = ts.transpileModule(fs.readFileSync(path.join(source, from), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  code = code.replace(/from\s+(['"])(\.{1,2}\/[^'"]+)\1/g, (match, quote, specifier) => {
    const candidate = path.join(path.dirname(from), specifier);
    const dependency = [candidate + '.ts', candidate + '.tsx', path.join(candidate, 'index.ts')].find(p => fs.existsSync(path.join(source, p)));
    if (!dependency) throw new Error(`Cannot resolve ${key} ${specifier}`);
    compile(repo, dependency);
    const relative = path.relative(path.dirname(from), dependency).replaceAll('\\', '/').replace(/\.tsx?$/, '.mjs');
    return `from ${quote}${relative.startsWith('.') ? relative : './' + relative}${quote}`;
  });
  const dest = path.join(root, 'compiled', repo, from.replace(/\.tsx?$/, '.mjs'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, code);
}
for (const [repo, source] of [['juryflow', 'src/engine/index.ts'], ['juryflow', 'src/io.ts'], ['tracekit', 'packages/tracekit/src/index.ts'], ['packetlab', 'src/core/simulation.ts']]) compile(repo, source);
const load = (repo, source) => import(pathToFileURL(path.join(root, 'compiled', repo, source)).href + `?v=${Date.now()}`);
const jury = await load('juryflow', 'src/engine/index.mjs');
const trace = await load('tracekit', 'packages/tracekit/src/index.mjs');
const { Simulation } = await load('packetlab', 'src/core/simulation.mjs');
const { DEFAULT_CONFIG, LIMITS, exportReplay, importReplay } = await load('packetlab', 'src/core/config.mjs');
const results = { seed: 0x5ea0511, jury: {}, trace: {}, packet: {} };
let rngState = results.seed;
const rng = () => { rngState = (Math.imul(rngState,1664525)+1013904223)>>>0; return rngState/4294967296; };
const int = n => Math.floor(rng()*n);
const pickSlots = n => Array.from({length:n},(_,i)=>i).filter(()=>rng()<0.72);

// Independent direct enumerator: no candidate domains, solver validators, MRV,
// or implementation-specific necessary checks are reused.
function oracle(project, previous = []) {
  let minimum = Infinity, witness;
  const prior = new Map(previous.map(a=>[a.teamId,a]));
  const assignmentEqual = (a,b) => a.teamId===b.teamId && a.slot===b.slot && a.roomId===b.roomId && JSON.stringify([...a.judgeIds].sort())===JSON.stringify([...b.judgeIds].sort());
  const panels = (ids, count) => {
    const output=[];
    for(let mask=0;mask<2**ids.length;mask++) {
      const panel=ids.filter((_,i)=>mask&(1<<i));
      if(panel.length===count)output.push(panel);
    }
    return output;
  };
  function walk(index, assignments) {
    if(index===project.teams.length) {
      const cost=assignments.reduce((sum,a)=>sum+(prior.has(a.teamId)&&!assignmentEqual(a,prior.get(a.teamId))?1:0),0);
      if(cost<minimum){minimum=cost;witness=structuredClone(assignments);}
      return;
    }
    const team=project.teams[index], lock=project.locks.find(a=>a.teamId===team.id);
    for(let slot=0;slot<project.slotCount;slot++) {
      if(!team.availableSlots.includes(slot))continue;
      for(const room of project.rooms) {
        if(!room.availableSlots.includes(slot) || assignments.some(a=>a.slot===slot&&a.roomId===room.id))continue;
        const eligible=project.judges.filter(j=>j.availableSlots.includes(slot)&&!team.excludedJudgeIds.includes(j.id)).map(j=>j.id);
        for(const panel of panels(eligible,team.judgeCount)) {
          if(team.requiredJudgeIds.some(id=>!panel.includes(id)))continue;
          if(assignments.some(a=>a.slot===slot&&a.judgeIds.some(id=>panel.includes(id))))continue;
          const a={teamId:team.id,slot,roomId:room.id,judgeIds:panel};
          if(lock&&!assignmentEqual(a,lock))continue;
          walk(index+1,[...assignments,a]);
        }
      }
    }
  }
  walk(0,[]);
  return {minimum,witness};
}
let feasible=0,infeasible=0,preferences=0,locked=0;
for(let caseId=0;caseId<450;caseId++) {
  const slots=1+int(3), judgeCount=1+int(3), roomCount=1+int(2), teamCount=int(5);
  const project={id:`case-${caseId}`,name:'Synthetic oracle',date:'2026-11-14',startTime:'23:45',slotMinutes:120,slotCount:slots,
    judges:Array.from({length:judgeCount},(_,i)=>({id:['j,a','j|b','j-c'][i],name:`Judge ${i}`,expertise:'',availableSlots:pickSlots(slots)})),
    rooms:Array.from({length:roomCount},(_,i)=>({id:`r-${i}`,name:`Room ${i}`,availableSlots:pickSlots(slots)})),
    teams:Array.from({length:teamCount},(_,i)=>({id:`t-${i}`,name:`Team ${i}`,track:'',availableSlots:pickSlots(slots),judgeCount:1+int(judgeCount),requiredJudgeIds:[],excludedJudgeIds:[]})),locks:[]};
  for(const team of project.teams) {
    for(const judge of project.judges) {
      if(rng()<0.15&&team.requiredJudgeIds.length<team.judgeCount)team.requiredJudgeIds.push(judge.id);
      else if(rng()<0.2)team.excludedJudgeIds.push(judge.id);
    }
  }
  let expected=oracle(project);
  if(expected.witness && expected.witness.length && rng()<0.5) {
    project.locks=expected.witness.filter(()=>rng()<0.35); locked+=project.locks.length;
    expected=oracle(project);
  }
  const previous=project.teams.map(t=>({teamId:t.id,slot:int(slots),roomId:project.rooms[int(roomCount)].id,judgeIds:project.judges.filter(()=>rng()<0.5).map(j=>j.id)}));
  const usePrevious=caseId%2===0;
  if(usePrevious){expected=oracle(project,previous);preferences++;}
  const options={maxNodes:5_000_000,timeBudgetMs:10_000,...(usePrevious?{previous}: {})};
  const actual=jury.solve(project,options);
  try {
    assert.equal(actual.status,expected.witness?'feasible':'infeasible');
    if(expected.witness) {
      feasible++;
      assert.equal(actual.assignments.length,project.teams.length);
      assert.ok(oracle({...project,locks:actual.assignments}).witness,'returned assignment must independently satisfy all constraints');
      assert.equal(jury.validateSchedule(project,actual.assignments).length,0);
      assert.equal(actual.changedCount,expected.minimum);
      if(usePrevious)assert.equal(actual.preferenceProven,true);
    } else infeasible++;
    const frozen=JSON.stringify(project);
    jury.solve(project,{...options,shouldCancel:()=>true});
    assert.equal(JSON.stringify(project),frozen);
  }catch(error){fs.writeFileSync(path.join(root,'jury-failure.json'),JSON.stringify({caseId,project,previous,expected,actual},null,2));throw error;}
}
const cancelBase={id:'cancel',name:'cancel',date:'2026-01-01',startTime:'09:00',slotMinutes:5,slotCount:1,
  teams:[{id:'t',name:'t',track:'',availableSlots:[0],judgeCount:1,requiredJudgeIds:[],excludedJudgeIds:[]}],
  judges:[{id:'j',name:'j',expertise:'',availableSlots:[0]}],rooms:[{id:'r',name:'r',availableSlots:[0]}],locks:[]};
assert.equal(jury.solve(cancelBase,{maxNodes:0}).status,'unknown');
assert.equal(jury.solve(cancelBase,{shouldCancel:()=>true}).status,'cancelled');
assert.equal(jury.solve(cancelBase,{timeBudgetMs:0}).status,'unknown');
results.jury={cases:450,feasible,infeasible,preferences,locked,checks:'independent exhaustive SAT/UNSAT and minimum disruption, cancellation, zero budgets, input immutability'};
const originalJury=structuredClone(cancelBase);
const detached=jury.solve(cancelBase);
detached.assignments[0].judgeIds[0]='tampered';
assert.deepEqual(cancelBase,originalJury);
assert.equal(jury.solve(cancelBase).assignments[0].judgeIds[0],'j');

// Independent arithmetic reducer used as fixed-logic truth, across many full sequences.
function expectedCheckout(events) {
  let quantity=1,coupon=null,shipping='standard',submitted=false;
  return events.map(event=>{
    submitted=event.type==='checkout.submit';
    if(event.type==='cart.quantity')quantity=event.quantity;
    if(event.type==='coupon.apply')coupon='TRACE10';
    if(event.type==='coupon.remove')coupon=null;
    if(event.type==='shipping.select')shipping=event.method;
    const subtotalCents=quantity*8900,discountCents=coupon?subtotalCents/10:0,shippingCents=shipping==='express'?1500:500;
    return {quantity,unitPriceCents:8900,coupon,shipping,subtotalCents,discountCents,shippingCents,totalCents:subtotalCents-discountCents+shippingCents,submitted};
  });
}
let eventTotal=0;
for(let caseId=0;caseId<320;caseId++) {
  const events=Array.from({length:int(101)},()=>[
    {type:'cart.quantity',quantity:1+int(9)}, {type:'coupon.apply',code:'TRACE10'}, {type:'coupon.remove'},
    {type:'shipping.select',method:rng()<0.5?'standard':'express'}, {type:'checkout.submit'}][int(5)]);
  const expected=expectedCheckout(events);eventTotal+=events.length;
  for(const scenario of ['coupon-ghost','shipping-drift']) {
    const fixed=trace.recordTrace(events,scenario,'fixed');
    assert.deepEqual(fixed.entries.map(e=>e.state),expected);
    const buggy=trace.recordTrace(events,scenario,'buggy');
    assert.deepEqual(trace.replayTrace(buggy,'fixed').slice(1),expected);
    assert.deepEqual(trace.replayTrace(buggy).slice(1),buggy.entries.map(e=>e.state));
    assert.equal(trace.exportTrace(trace.importTrace(trace.exportTrace(buggy))),trace.exportTrace(buggy));
    assert.equal(trace.exportTrace(trace.importTrace(trace.exportTrace(fixed))),trace.exportTrace(fixed));
    expected.forEach((state,i)=>{
      const diffs=trace.compareStates(state,buggy.entries[i].state);
      for(const diff of diffs){assert.equal(diff.expected,state[diff.field]);assert.equal(diff.actual,buggy.entries[i].state[diff.field]);}
    });
  }
}
results.trace={cases:320,scenarios:2,eventTotal,checks:'independent fixed arithmetic oracle at every state; both deliberate buggy modes replay; byte stable export/import; truthful expected/actual field values'};
const frozenEvents=Object.freeze([Object.freeze({type:'cart.quantity',quantity:3}),Object.freeze({type:'coupon.apply',code:'TRACE10'})]);
const detachedTrace=trace.recordTrace(frozenEvents,'coupon-ghost','fixed');
detachedTrace.entries[0].event.quantity=9;
assert.equal(frozenEvents[0].quantity,3);
assert.equal(detachedTrace.entries[1].state.quantity,3);
const frozenTrace=trace.recordTrace(frozenEvents,'coupon-ghost','fixed');
for(const entry of frozenTrace.entries){Object.freeze(entry.state);Object.freeze(entry.event);Object.freeze(entry);}
Object.freeze(frozenTrace.entries);Object.freeze(frozenTrace.initialState);Object.freeze(frozenTrace);
const detachedReplay=trace.replayTrace(frozenTrace);detachedReplay[1].quantity=7;
assert.equal(detachedReplay[2].quantity,3);assert.equal(frozenTrace.entries[0].state.quantity,3);
assert.throws(()=>trace.recordTrace(Array.from({length:101},()=>({type:'checkout.submit'})),'coupon-ghost','fixed'));

// Model invariants observed after every event, including packet conservation.
let packetEvents=0;
for(let caseId=0;caseId<180;caseId++) {
  const config={...DEFAULT_CONFIG,seed:caseId===0?0:caseId===1?4294967295:int(4294967296),messageCount:1+int(8),sendIntervalMs:[0,1,10,100,2000][int(5)],delayMs:[10,100,2000][int(3)],jitterMs:[0,90,1000][int(3)],loss:[0,0.3,0.8,1][int(4)],duplicate:[0,0.2,1][int(3)],ack:rng()<0.7,retry:rng()<0.7,dedup:rng()<0.7,backoff:rng()<0.5,retryJitter:rng()<0.5,timeoutMs:[20,100,5000][int(3)],maxAttempts:1+int(12),queueCapacity:1+int(8),serviceMs:[10,35,500][int(3)]};
  const sim=new Simulation(config);let last=sim.getSnapshot(), steps=0,receivedData=0,receivedAck=0,departed=0;
  const counters={dataQueues:0,ackQueues:0,dataOverflow:0,ackOverflow:0,loss:0,transmit:0,duplicate:0};let seenTrace=0;
  while(!['complete','limited'].includes(last.status)) {
    const event=last.pending[0];assert.ok(event);
    const next=sim.step(); steps++;packetEvents++;
    if(event.kind==='receive_data')receivedData++;
    if(event.kind==='receive_ack')receivedAck++;
    if(event.kind.startsWith('depart_'))departed++;
    assert.ok(next.now>=last.now);
    assert.ok(next.metrics.delivered>=last.metrics.delivered);
    assert.ok(next.metrics.acknowledged<=next.metrics.delivered);
    assert.ok(next.metrics.sent<=config.messageCount*config.maxAttempts);
    assert.equal(next.metrics.retries,next.metrics.sent-next.messages.filter(m=>m.attempts>0).length);
    assert.equal(next.metrics.applied,config.dedup?next.metrics.delivered:receivedData);
    assert.equal(next.metrics.duplicates,receivedData-next.metrics.delivered);
    assert.equal(next.metrics.delivered,next.messages.filter(m=>m.deliveredAt!==null).length);
    assert.ok(next.pending.length<=LIMITS.maxPending&&next.trace.length<=LIMITS.maxTrace&&next.series.length<=LIMITS.maxSamples);
    for(let i=1;i<next.pending.length;i++)assert.ok(next.pending[i].time>next.pending[i-1].time||(next.pending[i].time===next.pending[i-1].time&&next.pending[i].id>next.pending[i-1].id));
    for(const direction of ['data','ack'])assert.ok(next.pending.filter(e=>e.kind===`depart_${direction}`).length<=config.queueCapacity);
    assert.equal(next.inFlight.length,next.pending.filter(e=>e.kind==='receive_data'||e.kind==='receive_ack').length);
    for(const entry of next.trace.filter(e=>e.id>seenTrace)) {
      if(entry.kind==='queue')counters[entry.detail.startsWith('DATA')?'dataQueues':'ackQueues']++;
      if(entry.kind==='drop_overflow')counters[entry.detail.startsWith('DATA')?'dataOverflow':'ackOverflow']++;
      if(entry.kind==='drop_loss')counters.loss++;
      if(entry.kind==='transmit')counters.transmit++;
      if(entry.kind==='duplicate')counters.duplicate++;
    }
    seenTrace=next.trace.at(-1)?.id??seenTrace;
    assert.equal(next.metrics.sent,counters.dataQueues+counters.dataOverflow);
    assert.equal(counters.ackQueues+counters.ackOverflow,config.ack?receivedData:0);
    assert.equal(counters.dataQueues+counters.ackQueues,departed+next.pending.filter(e=>e.kind.startsWith('depart_')).length);
    assert.equal(departed,counters.transmit+counters.loss);
    assert.equal(counters.transmit+counters.duplicate,receivedData+receivedAck+next.inFlight.length);
    assert.equal(next.metrics.dropped,counters.loss+counters.dataOverflow+counters.ackOverflow);
    assert.ok(steps<=LIMITS.maxEvents);last=next;
  }
  if(last.status==='complete') {
    assert.equal(last.pending.length,0);assert.equal(last.inFlight.length,0);
    assert.equal(last.metrics.failed+(config.ack?last.metrics.acknowledged:last.metrics.delivered),config.messageCount);
  }
  assert.deepEqual(new Simulation(importReplay(exportReplay(config))).runToEnd(),last);
  const framed=new Simulation(config);let cursor=0;
  while(!['complete','limited'].includes(framed.getSnapshot().status)){cursor+=17.5;framed.advanceTo(cursor);}
  assert.deepEqual(framed.getSnapshot(),last);
}
results.packet={cases:180,eventSteps:packetEvents,checks:'event ordering, directional queue caps, immutable public accounting, DATA/ACK conservation including duplicate flights, retry budget, termination, seed/replay/frame cadence equivalence'};
const configCopy={...DEFAULT_CONFIG,seed:123};const detachedSim=new Simulation(configCopy);const cleanSim=new Simulation(configCopy);
configCopy.loss=1;const snapshot=detachedSim.step();cleanSim.step();
snapshot.config.loss=1;snapshot.metrics.sent=100;snapshot.messages[0].attempts=999;
snapshot.pending[0].time=999999;if(snapshot.trace[0])snapshot.trace[0].detail='tampered';
if(snapshot.series[0])snapshot.series[0].time=999999;if(snapshot.inFlight[0])snapshot.inFlight[0].end=999999;
assert.deepEqual(detachedSim.runToEnd(),cleanSim.runToEnd());
fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
