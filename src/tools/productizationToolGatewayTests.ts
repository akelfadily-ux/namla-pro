/** C6 coordinator tests. The effect and storage ports below are TEST doubles,
 * not real PostgreSQL, kernel permits, process isolation or runtime wiring. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { PolicyEngine } from "../application/policy-engine";
import { ToolGateway, ProductizationToolRefusal, PRODUCTIZATION_TOOL_OPERATION_TYPE,
  type ToolGatewayOptions, type GatewayAuthorityStore, type GatewayContext,
  type GatewayToolBinding, type ClaimedToolRequest, type TrustedToolOutcome } from "../application/tool-gateway";
import { decideOperationClaim, completeOperationClaim, failOperationClaim,
  type OperationExecutionRecord } from "../v2/kernel/executionAuthority";

const NOW = 1_800_000_000_000;
function ctx(overrides: Partial<GatewayContext> = {}): { -readonly [K in keyof GatewayContext]: GatewayContext[K] } {
  return {runId:"mission-1",taskId:"task-1",antId:"ant-1",traceId:"trace-1",operationId:"op-1",
    permissions:["tool:fixture.echo"],authority:{missionId:"mission-1",taskId:"task-1",workerId:"worker-1",
      authorityScope:"PRO/A/task-1",leaseToken:"lease-1",leaseEpoch:1,expiresAt:NOW+60_000},...overrides};
}
function binding(): GatewayToolBinding {
  return {name:"fixture.echo",revision:"fixture-v1",validateInput:v=>v,
    getPermissionRequests:()=>[{capability:"tool:fixture.echo"}]};
}
function deferred<T>() { let resolve!: (v:T)=>void, reject!: (e:unknown)=>void;
  const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
class MemoryPort implements GatewayAuthorityStore {
  now=NOW; record:OperationExecutionRecord|null=null; value:unknown; calls:string[]=[];
  enabled=true; lastClaim:Parameters<GatewayAuthorityStore["claimOperation"]>[0]|undefined;
  async claimOperation(input:Parameters<GatewayAuthorityStore["claimOperation"]>[0]): ReturnType<GatewayAuthorityStore["claimOperation"]> {
    this.calls.push("claim"); this.lastClaim=input;
    if(!this.enabled) return {ok:false as const,status:"REFUSED" as const,reasonCode:"task-authority-expired" as const};
    const result=decideOperationClaim({...input,existing:this.record,now:this.now,tokenFactory:()=>"claim-1"});
    if(result.ok && result.status === "CLAIMED") this.record=result.record!;
    if(!result.ok) return {...result,ok:false as const,status:"REFUSED" as const};
    if(result.status === "REFUSED") throw new Error("fixture contradictory decision");
    return {...result,status:result.status,ok:true as const,reasonCode:"ok" as const,
      ...(result.status === "REPLAY_COMPLETED" ? {completedValue:this.value} : {})};
  }
  async completeOperation(input:Parameters<GatewayAuthorityStore["completeOperation"]>[0]): ReturnType<GatewayAuthorityStore["completeOperation"]> {
    this.calls.push("complete");
    const result=completeOperationClaim(this.record!,input.authority,input.claimToken,input.claimEpoch,this.now+1);
    if(result.ok){this.record=result.record;this.value=JSON.parse(JSON.stringify(input.value));} return result;
  }
  async failOperation(input:Parameters<GatewayAuthorityStore["failOperation"]>[0]): ReturnType<GatewayAuthorityStore["failOperation"]> {
    this.calls.push("fail");
    const result=failOperationClaim(this.record!,input.authority,input.claimToken,input.claimEpoch,this.now+1);
    if(result.ok)this.record=result.record;return result;
  }
}
function fixture(change:Partial<ToolGatewayOptions>={}) {
  const store=new MemoryPort();const seen:ClaimedToolRequest[]=[];
  const executor={async executeClaimed(r:ClaimedToolRequest):Promise<TrustedToolOutcome>{seen.push(r);return {status:"SUCCEEDED",value:r.input};}};
  const options:ToolGatewayOptions={bindings:[binding()],policy:new PolicyEngine(),authorityStore:store,executor,clock:()=>store.now,...change};
  return {store,seen,executor,options,gateway:new ToolGateway(options)};
}
function denied(reason?:string) { return (e:unknown)=>{
  assert.ok(e instanceof ProductizationToolRefusal);
  assert.equal(e.retryable,false); if(reason)assert.equal(e.reasonCode,reason);return true;
}; }
const invoke=(g:ToolGateway,input:unknown={message:"hello"},c:GatewayContext=ctx(),time=1000)=>g.execute("fixture.echo",input,c,time);

test("C6 new invocation uses V2 claim then explicit execution boundary then fenced completion",async()=>{
  const f=fixture();const result=await invoke(f.gateway);
  assert.equal(JSON.stringify(result),'{"message":"hello"}'); assert.deepEqual(f.store.calls,["claim","complete"]);
  assert.equal(f.seen.length,1);assert.equal(f.seen[0].claim.claimEpoch,1);
  assert.equal(f.store.lastClaim?.operationType,PRODUCTIZATION_TOOL_OPERATION_TYPE);
  assert.equal(f.store.record?.status,"COMPLETED");
});
test("C6 explicit completed replay in a fresh gateway does not invoke executor or completion again",async()=>{
  const f=fixture();await invoke(f.gateway); const fresh=new ToolGateway(f.options);await invoke(fresh);
  assert.equal(f.seen.length,1);assert.deepEqual(f.store.calls,["claim","complete","claim"]);
});
test("C6 replay is reauthorized and revoked permissions never reach the store",async()=>{
  const f=fixture();await invoke(f.gateway);await assert.rejects(invoke(new ToolGateway(f.options),{},ctx({permissions:[]})),denied("PERMISSION_REFUSED"));
  assert.deepEqual(f.store.calls,["claim","complete"]);
});
test("C6 the authoritative store can refuse even a syntactically valid lease and wildcard entitlement",async()=>{
  const f=fixture();f.store.enabled=false;await assert.rejects(invoke(f.gateway,{},ctx({permissions:["*"]})),denied("CLAIM_REFUSED"));assert.equal(f.seen.length,0);
});
test("C6 replay under a new worker lease retains original operation binding and never reexecutes",async()=>{
  const f=fixture();await invoke(f.gateway); const c=ctx();c.authority={...c.authority,workerId:"worker-2",leaseToken:"lease-2",leaseEpoch:2};
  await invoke(new ToolGateway(f.options),{message:"hello"},c);assert.equal(f.seen.length,1);
});
test("C6 old donor worker-and-token-only context is not a full V2 authority",async()=>{
  const f=fixture();await assert.rejects(invoke(f.gateway,{},ctx({authority:{workerId:"w",leaseToken:"t"} as never})),denied());assert.equal(f.store.calls.length,0);
});
test("C6 cross-mission cross-task expired and malformed authorities are refused before storage",async()=>{
  for(const patch of [{missionId:"other"},{taskId:"other"},{expiresAt:NOW},{leaseEpoch:0},{leaseToken:""}]) {
    const f=fixture(),c=ctx(); c.authority={...c.authority,...patch};await assert.rejects(invoke(f.gateway,{},c),denied());assert.equal(f.seen.length,0);assert.equal(f.store.calls.length,0);
  }
});
test("C6 unknown tools and invalid time budgets do not acquire claims",async()=>{
  const f=fixture();await assert.rejects(f.gateway.execute("missing",{},ctx()),denied("UNKNOWN_TOOL"));
  for(const n of [0,-1,1.5,NaN,Infinity,300001])await assert.rejects(invoke(f.gateway,{},ctx(),n),denied("INVALID_INPUT"));assert.equal(f.store.calls.length,0);
});
test("C6 executor and authority ports are mandatory with no direct adapter fallback",()=>{
  const f=fixture();for(const name of ["executor","authorityStore","policy"]){const o={...f.options};delete(o as unknown as Record<string,unknown>)[name];assert.throws(()=>new ToolGateway(o),denied("INVALID_CONFIGURATION"));}
  const b={...binding(),execute:()=>{throw new Error("must not call");}};
  assert.throws(()=>new ToolGateway({...f.options,bindings:[b]}),denied("INVALID_CONFIGURATION"));
});
test("C6 binding names revisions callback shapes and dense registration are required",()=>{
  const f=fixture();for(const bs of [[],new Array(1),[binding(),binding()],[{...binding(),name:"INVALID"}],[{...binding(),revision:""}],[{...binding(),getPermissionRequests:undefined}]])
    assert.throws(()=>new ToolGateway({...f.options,bindings:bs as never}),denied("INVALID_CONFIGURATION"));
});
test("C6 configuration method getters and proxies do not execute",()=>{
  const f=fixture();let calls=0;const exec={get executeClaimed(){calls++;return ()=>{};}};
  assert.throws(()=>new ToolGateway({...f.options,executor:exec as never}),denied());
  assert.throws(()=>new ToolGateway(new Proxy(f.options,{ownKeys(){calls++;return [];}})),denied());assert.equal(calls,0);
});
test("C6 constructor captures reviewed binding methods before external method replacement",async()=>{
  const b=binding();const f=fixture({bindings:[b]});b.validateInput=()=>{throw new Error("replaced");};
  f.executor.executeClaimed=async()=>{throw new Error("replaced");};await invoke(f.gateway);assert.equal(f.seen.length,1);
});
test("C6 callback validation failure is sanitized and precedes storage",async()=>{
  const b=binding();b.validateInput=()=>{throw new Error("private input");};const f=fixture({bindings:[b]});
  await assert.rejects(invoke(f.gateway),denied("INVALID_INPUT"));assert.equal(f.store.calls.length,0);
});
test("C6 permissions are mandatory dense and include the registered tool capability",async()=>{
  for(const reqs of [[],new Array(1),[{capability:"tool:other"}],[{capability:"tool:fixture.echo",extra:true}]]){
    const b=binding();b.getPermissionRequests=()=>reqs as never;const f=fixture({bindings:[b]});await assert.rejects(invoke(f.gateway),denied());assert.equal(f.store.calls.length,0);
  }
});
test("C6 every requested permission must pass C5 before any claim",async()=>{
  const b=binding();b.getPermissionRequests=()=>[{capability:"tool:fixture.echo"},{capability:"tool:missing"}];
  const f=fixture({bindings:[b]});await assert.rejects(invoke(f.gateway),denied("PERMISSION_REFUSED"));assert.equal(f.store.calls.length,0);
});
test("C6 raw shell and human-only Git cannot use wildcard grants to bypass C5",async()=>{
  for(const name of ["shell","docker","git"]){const b=binding();const adapted={...b,name,getPermissionRequests:()=>[{capability:"tool:"+name,...(name==="git"?{gitOperation:{kind:"forbidden",action:"merge"}}:{})}]};
    const f=fixture({bindings:[adapted as GatewayToolBinding]});await assert.rejects(f.gateway.execute(name,{},ctx({permissions:["*"]})),denied("PERMISSION_REFUSED"));assert.equal(f.seen.length,0);}
});
test("C6 input records arrays proxies and getters are refused before callbacks",async()=>{
  let reads=0;const getter={get x(){reads++;return 1;}};const proxy=new Proxy({},{ownKeys(){reads++;return [];}});
  for(const v of [getter,proxy,new Array(2),{x:undefined},()=>0,new Date(),1n,new Uint8Array([1]),-0,NaN]){
    const f=fixture();await assert.rejects(invoke(f.gateway,v),denied("INVALID_INPUT"));assert.equal(f.store.calls.length,0);
  } assert.equal(reads,0);
});
test("C6 JSONB-incompatible NUL lone surrogates cycles and excess data are refused",async()=>{
  const cycle:unknown[]=[];cycle.push(cycle);let deep:unknown=0;for(let i=0;i<42;i++)deep=[deep];
  for(const v of ["\0","\ud800",cycle,deep,"x".repeat(1_048_577),Array(9000).fill(0)]){
    const f=fixture();await assert.rejects(invoke(f.gateway,v),denied("INVALID_INPUT"));assert.equal(f.store.calls.length,0);
  }
});
test("C6 caller input context and permission mutation during claim wait cannot alter dispatch",async()=>{
  const store=new MemoryPort(),ready=deferred<void>();const original=store.claimOperation.bind(store);
  store.claimOperation=async x=>{await ready.promise;return original(x);};const f=fixture({authorityStore:store});
  const input={nested:{x:1}},c=ctx();const p=invoke(f.gateway,input,c);input.nested.x=9;c.permissions=[];c.authority={...c.authority,leaseToken:"wrong"};
  ready.resolve();await p;assert.equal(JSON.stringify(f.seen[0].input),'{"nested":{"x":1}}');assert.equal(f.seen[0].context.authority.leaseToken,"lease-1");
});
test("C6 a same-instance concurrent invocation never issues a second claim",async()=>{
  const ready=deferred<TrustedToolOutcome>();const f=fixture({executor:{executeClaimed:()=>ready.promise}});
  const p=invoke(f.gateway);await assert.rejects(invoke(f.gateway),denied("IN_FLIGHT"));ready.resolve({status:"SUCCEEDED",value:1});await p;
  assert.equal(f.store.calls.filter(x=>x==="claim").length,1);
});
test("C6 separate instances honor ALREADY_CLAIMED_BY_CALLER without a second effect",async()=>{
  const ready=deferred<TrustedToolOutcome>();let effects=0;const f=fixture({executor:{executeClaimed:()=>{effects++;return ready.promise;}}});
  const p=invoke(f.gateway);await assert.rejects(invoke(new ToolGateway(f.options)),denied("IN_FLIGHT"));ready.resolve({status:"SUCCEEDED",value:1});await p;assert.equal(effects,1);
});
test("C6 a live claim held by another worker refuses without executor entry",async()=>{
  const ready=deferred<TrustedToolOutcome>();const f=fixture({executor:{executeClaimed:()=>ready.promise}});const p=invoke(f.gateway);
  const c=ctx();c.authority={...c.authority,workerId:"other",leaseToken:"other",leaseEpoch:2};
  await assert.rejects(invoke(new ToolGateway(f.options),{message:"hello"},c),denied("CLAIM_REFUSED"));ready.resolve({status:"SUCCEEDED",value:1});await p;
});
test("C6 higher claim epochs quarantine expired unknown work instead of reexecuting",async()=>{
  const f=fixture();f.store.completeOperation=async()=>{throw new Error("unused replacement");};
  // Seed the canonical state machine with a running first claim, not a completion.
  const ready=deferred<TrustedToolOutcome>();const first=new ToolGateway({...f.options,executor:{executeClaimed:()=>ready.promise}});
  const p=invoke(first,{},ctx(),5);await assert.rejects(p,denied("OUTCOME_UNKNOWN"));f.store.now=NOW+10;
  const fresh=new ToolGateway(f.options);await assert.rejects(invoke(fresh,{}),denied("RECOVERY_REQUIRED"));assert.equal(f.seen.length,0);
  assert.equal(f.store.record?.claimEpoch,2);assert.equal(fresh.isFailedClosed(),true);ready.resolve({status:"SUCCEEDED",value:0});
});
test("C6 changed input cannot reuse a completed operation identifier",async()=>{
  const f=fixture();await invoke(f.gateway,{x:1});await assert.rejects(invoke(new ToolGateway(f.options),{x:2}),denied("CLAIM_REFUSED"));assert.equal(f.seen.length,1);
});
test("C6 binding revisions and generated permission requests are part of durable identity",async()=>{
  const f=fixture();await invoke(f.gateway); const b={...binding(),revision:"fixture-v2"};
  await assert.rejects(invoke(new ToolGateway({...f.options,bindings:[b]})),denied("CLAIM_REFUSED"));
  const changed={...binding(),getPermissionRequests:()=>[{capability:"tool:fixture.echo",resource:"other"}]};
  await assert.rejects(invoke(new ToolGateway({...f.options,bindings:[changed]})),denied("CLAIM_REFUSED"));assert.equal(f.seen.length,1);
});
test("C6 malformed contradictory and unknown claim replies fail closed",async()=>{
  for(const value of [{ok:true,status:"FUTURE",reasonCode:"ok"},{ok:"yes",status:"CLAIMED",reasonCode:"ok"},null]){
    const store=new MemoryPort();store.claimOperation=async()=>value as never;const f=fixture({authorityStore:store});
    await assert.rejects(invoke(f.gateway),denied("RECEIPT_INVALID"));assert.equal(f.gateway.isFailedClosed(),true);assert.equal(f.seen.length,0);
  }
});
test("C6 wrong receipt mission task scope hash token owner and version are refused",async()=>{
  for(const patch of [{missionId:"other"},{taskId:"other"},{authorityScope:"other"},{inputFingerprint:"0".repeat(64)},
    {claimToken:""},{claimOwnerWorkerId:"other"},{claimTaskLeaseEpoch:2},{claimEpoch:0}]){
    const store=new MemoryPort(),original=store.claimOperation.bind(store);store.claimOperation=async x=>{const r=await original(x);return {...r,record:{...r.record,...patch}} as never;};
    const f=fixture({authorityStore:store});await assert.rejects(invoke(f.gateway),denied("RECEIPT_INVALID"));assert.equal(f.seen.length,0);
  }
});
test("C6 storage failure locks the instance without executor entry or implicit resume",async()=>{
  const store=new MemoryPort();store.claimOperation=async()=>{throw new Error("database secret");};const f=fixture({authorityStore:store});
  await assert.rejects(invoke(f.gateway),denied("STORAGE_FAILURE"));await assert.rejects(invoke(f.gateway),denied("SESSION_FAILED_CLOSED"));assert.equal(f.seen.length,0);
});
test("C6 replay must carry a complete matching versioned result envelope",async()=>{
  for(const change of [(f:ReturnType<typeof fixture>)=>{f.store.value=undefined;},(f:ReturnType<typeof fixture>)=>{f.store.value={result:1};},
    (f:ReturnType<typeof fixture>)=>{(f.store.value as Record<string,unknown>).fingerprint="wrong";}]){
    const f=fixture();await invoke(f.gateway);change(f);await assert.rejects(invoke(new ToolGateway(f.options)),denied("RECEIPT_INVALID"));assert.equal(f.seen.length,1);
  }
});
test("C6 false zero empty string null arrays and objects are valid completed values",async()=>{
  for(const value of [false,0,"",null,[],{}]){const f=fixture({executor:{executeClaimed:async()=>({status:"SUCCEEDED",value})}});
    const a=await invoke(f.gateway),b=await invoke(new ToolGateway(f.options));assert.equal(JSON.stringify(a),JSON.stringify(value));assert.equal(JSON.stringify(a),JSON.stringify(b));}
});
test("C6 returned and persisted result snapshots are detached from executor and replay data",async()=>{
  const value={x:{y:1}};const f=fixture({executor:{executeClaimed:async()=>({status:"SUCCEEDED",value})}});
  const result=await invoke(f.gateway);value.x.y=2;assert.equal(JSON.stringify(result),'{"x":{"y":1}}');assert.equal(Object.isFrozen(result),true);
  const replay=await invoke(new ToolGateway(f.options));assert.notEqual(result,replay);assert.equal(JSON.stringify(replay),JSON.stringify(result));
});
test("C6 explicit trusted refusal before an effect is fenced as FAILED without completing",async()=>{
  const f=fixture({executor:{executeClaimed:async()=>({status:"REFUSED_BEFORE_EFFECT"})}});
  await assert.rejects(invoke(f.gateway),denied("EXECUTOR_REFUSED"));assert.deepEqual(f.store.calls,["claim","fail"]);
  await assert.rejects(invoke(new ToolGateway(f.options)),denied("CLAIM_REFUSED"));
});
test("C6 executor exceptions are unknown outcomes and never converted into a retryable failed operation",async()=>{
  const f=fixture({executor:{executeClaimed:async()=>{throw new Error("secret effect error");}}});await assert.rejects(invoke(f.gateway),denied("OUTCOME_UNKNOWN"));
  assert.deepEqual(f.store.calls,["claim"]);assert.equal(f.store.record?.status,"RUNNING");assert.equal(f.gateway.isFailedClosed(),true);
});
test("C6 malformed or non-JSON executor output cannot be durably reported as successful",async()=>{
  for(const answer of [{status:"unknown"},{status:"SUCCEEDED"},{status:"SUCCEEDED",value:1n},{status:"REFUSED_BEFORE_EFFECT",value:1}]){
    const f=fixture({executor:{executeClaimed:async()=>answer as never}});await assert.rejects(invoke(f.gateway),denied("OUTCOME_UNKNOWN"));assert.deepEqual(f.store.calls,["claim"]);
  }
});
test("C6 cooperative timeout rejects promptly and ignores an eventual late success",async()=>{
  const ready=deferred<TrustedToolOutcome>();let signal:AbortSignal|undefined;
  const f=fixture({executor:{executeClaimed:(_r,s)=>{signal=s;return ready.promise;}}});
  await assert.rejects(invoke(f.gateway,{},ctx(),5),denied("OUTCOME_UNKNOWN"));assert.equal(signal?.aborted,true);
  ready.resolve({status:"SUCCEEDED",value:1});await new Promise(r=>setImmediate(r));assert.deepEqual(f.store.calls,["claim"]);
});
test("C6 a delayed result beyond the local claim deadline is not finalized",async()=>{
  const store=new MemoryPort();const f=fixture({authorityStore:store,clock:()=>store.now,executor:{executeClaimed:async()=>{store.now+=2000;return {status:"SUCCEEDED",value:1};}}});
  await assert.rejects(invoke(f.gateway),denied("OUTCOME_UNKNOWN"));assert.deepEqual(store.calls,["claim"]);
});
test("C6 lost completion acknowledgement is not followed by failOperation or another execution",async()=>{
  const store=new MemoryPort(),original=store.completeOperation.bind(store);store.completeOperation=async input=>{await original(input);throw new Error("ack lost");};
  let effects=0;const f=fixture({authorityStore:store,executor:{executeClaimed:async()=>{effects++;return {status:"SUCCEEDED",value:1};}}});
  await assert.rejects(invoke(f.gateway),denied("STORAGE_FAILURE"));assert.deepEqual(store.calls,["claim","complete"]);
  const replay=await invoke(new ToolGateway(f.options));assert.equal(replay,1);assert.equal(effects,1);
});
test("C6 completion refusal and corrupt final receipts do not produce success",async()=>{
  for(const corrupt of [false,true]){const store=new MemoryPort(),original=store.completeOperation.bind(store);
    store.completeOperation=async input=>{if(!corrupt)return {ok:false,status:"REFUSED",reasonCode:"claim-expired"};const r=await original(input);return {...r,record:{...store.record,claimEpoch:999}} as never;};
    const f=fixture({authorityStore:store});await assert.rejects(invoke(f.gateway),denied(corrupt?"RECEIPT_INVALID":"FINALIZE_REFUSED"));assert.equal(f.gateway.isFailedClosed(),true);assert.equal(store.calls.includes("fail"),false);
  }
});
test("C6 failed-operation persistence failure is surfaced and never silently ignored",async()=>{
  const store=new MemoryPort();store.failOperation=async()=>{throw new Error("failure save lost");};
  const f=fixture({authorityStore:store,executor:{executeClaimed:async()=>({status:"REFUSED_BEFORE_EFFECT"})}});
  await assert.rejects(invoke(f.gateway),denied("STORAGE_FAILURE"));assert.equal(f.gateway.isFailedClosed(),true);
});
test("C6 inputs errors and token values are not echoed in refusal messages",async()=>{
  const f=fixture({executor:{executeClaimed:async()=>{throw new Error("NEVER_LEAK");}}});
  await assert.rejects(invoke(f.gateway,{secret:"NEVER_LEAK"}),e=>{assert.ok(e instanceof ProductizationToolRefusal);assert.ok(!e.message.includes("NEVER_LEAK"));assert.equal(e.cause,undefined);return true;});
});
test("C6 source imports canonical authority and contains no direct tool adapter or raw effect path",()=>{
  const src=readFileSync(resolve("src/application/tool-gateway.ts"),"utf8");const ast=ts.createSourceFile("tool-gateway.ts",src,ts.ScriptTarget.Latest,true);
  const specs:string[]=[];const calls:string[]=[];
  const walk=(n:ts.Node)=>{if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier))specs.push(n.moduleSpecifier.text);
    if(ts.isCallExpression(n))calls.push(n.expression.getText(ast));ts.forEachChild(n,walk);};walk(ast);
  assert.ok(specs.includes("../v2/kernel/executionAuthority"));assert.ok(specs.includes("../v2/persistence/postgresExecutionAuthorityStore"));
  for(const spec of specs)assert.ok(!/node:(fs|child_process|http|https|net)|infrastructure|pg$/.test(spec),spec);
  assert.ok(!calls.some(c=>/adapter\.execute|spawn|execFile|writeFile|readFile|acquireTaskLease|renewTaskLease/.test(c)));
  assert.ok(calls.includes("this.executeBoundary"));assert.ok(calls.includes("this.claim"));
});

test("C6 replay detects changed stored output without treating a data hash as authenticated evidence",async()=>{
  const f=fixture();await invoke(f.gateway);(f.store.value as Record<string,unknown>).value={changed:true};
  await assert.rejects(invoke(new ToolGateway(f.options)),denied("RECEIPT_INVALID"));assert.equal(f.seen.length,1);
});
