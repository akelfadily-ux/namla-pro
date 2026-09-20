/** C3 component tests; no provider, shell, database or canonical execution. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import { DefaultAntAllocator } from "../application/ant-allocator";
import { GateEngine, type Gate, type GateContext, type GateResult } from "../application/gate-engine";
import { ConfigurationError, GateRejectedError } from "../domain/errors";
import { AntRole, TaskStatus } from "../domain/types";

function context(): GateContext {
  return {
    task: {id:"task-1",runId:"run-1",title:"Local test",description:"fixture",status:TaskStatus.Testing,
      role:AntRole.Tester,attempt:0,maxAttempts:1,depth:0,requirements:[],dependencies:[],
      createdAt:new Date(0),updatedAt:new Date(0)},
    artifacts:[],workspacePath:"inert-fixture-path",
  };
}
function result(gate="check-a", passed=true): GateResult {
  return {gate,passed,reason:"local check",evidence:[],requiredFixes:[]};
}
function gate(name="check-a", passed=true): Gate {
  return {name, evaluate:async () => result(name,passed)};
}
function deferred<T>() {
  let resolve!: (value:T) => void;
  const promise = new Promise<T>((done) => {resolve=done;});
  return {promise,resolve};
}
const allocator = new DefaultAntAllocator();
const id = (runId="run-1",taskId="task-1",role=AntRole.Engineer) => allocator.allocate(role,runId,taskId);

test("C3 gates evaluate sequentially in registered order", async () => {
  const calls:string[]=[];
  const pending=deferred<GateResult>();
  const engine=new GateEngine([
    {name:"a",evaluate:async()=>{calls.push("a");return pending.promise;}},
    {name:"b",evaluate:async()=>{calls.push("b");return result("b");}},
  ]);
  const evaluating=engine.evaluate(context());
  assert.deepEqual(calls,["a"]);
  pending.resolve(result("a"));
  const output=await evaluating;
  assert.deepEqual(calls,["a","b"]);
  assert.deepEqual(output.map(r=>r.gate),["a","b"]);
  assert.equal(GateEngine.passed(output),true);
});
test("C3 gates stop at the first false result and retain its diagnostics", async () => {
  let later=0;
  const rejected={...result("b",false),requiredFixes:["fix"],evidence:["ref"]};
  const output=await new GateEngine([gate("a"),{name:"b",evaluate:async()=>rejected},
    {name:"c",evaluate:async()=>{later++;return result("c");}}]).evaluate(context());
  assert.deepEqual(output,[result("a"),rejected]);
  assert.equal(later,0); assert.equal(GateEngine.passed(output),false);
});
test("C3 empty gate lists and empty reports never produce a passed summary", async () => {
  assert.deepEqual(await new GateEngine([]).evaluate(context()),[]);
  assert.equal(GateEngine.passed([]),false);
});
test("C3 sparse report arrays cannot claim vacuous success", () => {
  assert.equal(GateEngine.passed(new Array<GateResult>(1)),false);
  const mixed=[result()]; mixed.length=2;
  assert.equal(GateEngine.passed(mixed),false);
});
test("C3 malformed report shapes and truthy nonboolean verdicts are refused", async () => {
  for(const value of ["true",1,{},null,undefined]) {
    const raw={...result(),passed:value} as unknown as GateResult;
    assert.equal(GateEngine.passed([raw]),false);
    await assert.rejects(new GateEngine([{name:"check-a",evaluate:async()=>raw}]).evaluate(context()),GateRejectedError);
  }
  for(const value of [null,undefined,{},"yes",{length:1,0:result()}])
    assert.equal(GateEngine.passed(value as unknown as GateResult[]),false);
});
test("C3 result records require all and only the five declared fields", () => {
  for(const field of Object.keys(result())) {
    const raw:Record<string,unknown>={...result()}; delete raw[field];
    assert.equal(GateEngine.passed([raw as unknown as GateResult]),false);
  }
  assert.equal(GateEngine.passed([{...result(),extra:1} as GateResult]),false);
});
test("C3 wrong gate identity stops evaluation before later callbacks", async () => {
  let calls=0;
  const engine=new GateEngine([{name:"a",evaluate:async()=>result("other")},
    {name:"b",evaluate:async()=>{calls++;return result("b");}}]);
  await assert.rejects(engine.evaluate(context()),GateRejectedError);
  assert.equal(calls,0);
});
test("C3 result diagnostics must be typed dense data arrays", () => {
  for(const field of ["evidence","requiredFixes"]) {
    for(const value of [null,undefined,"ref",[1],new Array<string>(1)]) {
      assert.equal(GateEngine.passed([{...result(),[field]:value} as GateResult]),false);
    }
  }
  assert.equal(GateEngine.passed([{...result(),reason:3} as unknown as GateResult]),false);
});
test("C3 ordinary result getters are rejected without invocation", async () => {
  let reads=0;
  const raw={...result()};
  Object.defineProperty(raw,"passed",{enumerable:true,get(){reads++;return true;}});
  assert.equal(GateEngine.passed([raw]),false);
  await assert.rejects(new GateEngine([{name:"check-a",evaluate:async()=>raw}]).evaluate(context()),GateRejectedError);
  assert.equal(reads,0);
});
test("C3 array index getters and hidden or symbol properties are refused", () => {
  let reads=0;
  const inputs:unknown[]=[result()];
  Object.defineProperty(inputs,"0",{enumerable:true,get(){reads++;return result();}});
  assert.equal(GateEngine.passed(inputs as GateResult[]),false);
  const raw={...result()}; Object.defineProperty(raw,"reason",{enumerable:false,value:"hidden"});
  assert.equal(GateEngine.passed([raw]),false);
  const symbolic={...result(),[Symbol("x")]:1};
  assert.equal(GateEngine.passed([symbolic]),false);
  const decorated=Object.assign([result()],{extra:true});
  assert.equal(GateEngine.passed(decorated),false);
  assert.equal(reads,0);
});
test("C3 null-prototype result records remain valid and exotic records are refused", async () => {
  const raw=Object.assign(Object.create(null),result());
  assert.equal(GateEngine.passed([raw]),true);
  assert.deepEqual(await new GateEngine([{name:"check-a",evaluate:async()=>raw}]).evaluate(context()),[result()]);
  const custom=Object.assign(Object.create({marker:true}),result());
  assert.equal(GateEngine.passed([custom]),false);
});
test("C3 reflection exceptions fail closed instead of producing a substitute result", async () => {
  const revoked=Proxy.revocable(result(),{}); revoked.revoke();
  assert.equal(GateEngine.passed([revoked.proxy]),false);
  const reflective=new Proxy(result(),{ownKeys(){throw new Error("reflection fixture");}});
  await assert.rejects(new GateEngine([{name:"check-a",evaluate:async()=>reflective}]).evaluate(context()),GateRejectedError);
  // Resolving a revoked Proxy rejects during promise thenable inspection, before
  // result validation. That callback/promise error must propagate, not become PASS.
  await assert.rejects(new GateEngine([{name:"check-a",evaluate:async()=>revoked.proxy}]).evaluate(context()),TypeError);
});
test("C3 registered gate list names and methods are captured before asynchronous work", async () => {
  const original=gate("a"); const list=[original];
  const engine=new GateEngine(list);
  list.push(gate("b"));
  original.evaluate=async()=>result("changed");
  Object.defineProperty(original,"name",{value:"changed"});
  assert.deepEqual(await engine.evaluate(context()),[result("a")]);
});
test("C3 configuration rejects holes duplicates missing methods and invalid names", () => {
  for(const config of [new Array(1),[gate("a"),gate("a")],[{name:"a"}],
    [{name:"",evaluate:async()=>result()}],[null],null,{}]) {
    assert.throws(()=>new GateEngine(config as unknown as Gate[]),ConfigurationError);
  }
});
test("C3 configuration getters are rejected without being executed", () => {
  let reads=0; const raw=gate();
  Object.defineProperty(raw,"name",{get(){reads++;return "check-a";}});
  assert.throws(()=>new GateEngine([raw]),ConfigurationError);
  assert.equal(reads,0);
});
test("C3 ordinary class gate methods preserve their instance binding", async () => {
  class ClassGate implements Gate {
    readonly name="class-gate";
    private calls=0;
    async evaluate():Promise<GateResult> {this.calls++;return {...result(this.name),reason:String(this.calls)};}
  }
  const engine=new GateEngine([new ClassGate()]);
  assert.equal((await engine.evaluate(context()))[0].reason,"1");
  assert.equal((await engine.evaluate(context()))[0].reason,"2");
});
test("C3 callback exceptions propagate and later gates do not run", async () => {
  const failure=new Error("fixture-error"); let later=0;
  const engine=new GateEngine([{name:"a",evaluate:async()=>{throw failure;}},
    {name:"b",evaluate:async()=>{later++;return result("b");}}]);
  await assert.rejects(engine.evaluate(context()),e=>e===failure);
  assert.equal(later,0);
});
test("C3 returned results and nested diagnostics are detached and frozen", async () => {
  const raw={...result(),evidence:["original"],requiredFixes:["observe"]};
  const output=await new GateEngine([{name:"check-a",evaluate:async()=>raw}]).evaluate(context());
  raw.passed=false; raw.evidence.push("changed"); raw.requiredFixes[0]="changed";
  assert.equal(output[0].passed,true); assert.deepEqual(output[0].evidence,["original"]);
  assert.deepEqual(output[0].requiredFixes,["observe"]);
  assert.equal(Object.isFrozen(output[0]),true); assert.equal(Object.isFrozen(output[0].evidence),true);
  assert.equal(Object.isFrozen(raw),false); assert.equal(Object.isFrozen(raw.evidence),false);
});
test("C3 independent evaluation calls do not share result accumulators", async () => {
  const engine=new GateEngine([gate()]);
  const [a,b]=await Promise.all([engine.evaluate(context()),engine.evaluate(context())]);
  assert.notEqual(a,b); assert.notEqual(a[0],b[0]);
  a.length=0; assert.equal(b.length,1);
});
test("C3 structural passed summary does not fabricate canonical authority", () => {
  const local=result();
  assert.equal(GateEngine.passed([local]),true); // A shape check, not authentic proof.
  assert.deepEqual(Object.keys(local).sort(),["evidence","gate","passed","reason","requiredFixes"]);
  assert.equal("leaseToken" in local,false); assert.equal("contractHash" in local,false);
  assert.equal(GateEngine.passed([result(),result()]),false);
});
test("C3 GateEngine itself does not mutate task status or claim a workspace", async () => {
  const supplied=context(); const before=structuredClone(supplied);
  assert.equal(GateEngine.passed(await new GateEngine([gate()]).evaluate(supplied)),true);
  assert.deepEqual(supplied,before);
  assert.equal(supplied.task.status,TaskStatus.Testing);
});

test("C3 task-bound agent identifiers preserve deterministic allocation", () => {
  assert.equal(id(),id());
  assert.equal(id(),new DefaultAntAllocator().allocate(AntRole.Engineer,"run-1","task-1"));
  assert.match(id(),/^ant-engineer-v2-[0-9a-f]{64}$/);
});
test("C3 task IDs sharing eight-character prefixes no longer alias", () => {
  assert.notEqual(id("run-1","12345678-first"),id("run-1","12345678-second"));
});
test("C3 the full run identity participates in task-bound allocation", () => {
  assert.notEqual(id("run-1"),id("run-2"));
});
test("C3 the role participates in allocation without silently accepting unknown roles", () => {
  const allocated=Object.values(AntRole).map(role=>id("run-1","task-1",role));
  assert.equal(new Set(allocated).size,Object.values(AntRole).length);
  for(const bad of [undefined,null,"ENGINEER-OTHER",1,{},"engineer"])
    assert.throws(()=>allocator.allocate(bad as AntRole,"run-1","task-1"),ConfigurationError);
});
test("C3 identity tuple encoding cannot alias by delimiter concatenation", () => {
  assert.notEqual(id("a|b","c"),id("a","b|c"));
  const expected=createHash("sha256").update(JSON.stringify([
    "NAMLA_PRODUCTIZATION_ANT_ID",2,AntRole.Engineer,"run-1",["task","task-1"],
  ]),"utf8").digest("hex");
  assert.equal(id(),"ant-engineer-v2-"+expected);
});
test("C3 task-less allocations retain a fresh opaque identity", () => {
  const values=Array.from({length:32},()=>allocator.allocate(AntRole.Engineer,"run-1"));
  assert.equal(new Set(values).size,values.length); // Sample check, not a mathematical uniqueness proof.
  for(const value of values) assert.match(value,/^ant-engineer-v2-[0-9a-f]{64}$/);
});
test("C3 invalid run and supplied task identities are rejected without coercion", () => {
  for(const bad of [undefined,null,"","   ",1,{},"a\nb","a\u0000b"]) {
    assert.throws(()=>allocator.allocate(AntRole.Engineer,bad as string,"task"),ConfigurationError);
    if(bad!==undefined) assert.throws(()=>allocator.allocate(AntRole.Engineer,"run",bad as string),ConfigurationError);
  }
});
test("C3 Unicode and significant identity bytes are retained", () => {
  assert.equal(id("משימה","مهمة"),id("משימה","مهمة"));
  assert.notEqual(id("run","t"),id("run ","t"));
  assert.notEqual(id("r","\u00e9"),id("r","e\u0301"));
});
test("C3 identifiers expose no registry authority or caller-provided path", () => {
  const value=id("/inert/run","/inert/task");
  assert.equal(value.includes("inert"),false);
  assert.deepEqual(Object.keys(allocator),[]);
  assert.match(value,/^ant-engineer-v2-[0-9a-f]{64}$/);
});
test("C3 malformed gate and allocation errors do not echo input values", async () => {
  const secret="fixture-value-not-to-echo";
  assert.throws(()=>allocator.allocate(secret as AntRole,"r","t"),
    e=>e instanceof ConfigurationError && !e.message.includes(secret));
  await assert.rejects(new GateEngine([{name:"a",evaluate:async()=>({...result("a"),reason:{secret}} as unknown as GateResult)}]).evaluate(context()),
    e=>e instanceof GateRejectedError && !e.message.includes(secret));
});
test("C3 dependencies remain local components and built-in cryptography only", () => {
  const expected:Record<string,string[]>={
    "ant-allocator":["node:crypto","../domain/contracts","../domain/errors","../domain/types"],
    "gate-engine":["../domain/errors","../domain/types"],
  };
  for(const [name,allowed] of Object.entries(expected)) {
    const source=ts.createSourceFile(name,readFileSync(resolve(process.cwd(),"src/application",name+".ts"),"utf8"),ts.ScriptTarget.Latest,true);
    const seen:string[]=[];
    const visit=(node:ts.Node):void=>{
      if(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if(node.moduleSpecifier) {assert.ok(ts.isStringLiteral(node.moduleSpecifier));seen.push(node.moduleSpecifier.text);}
      }
      if(ts.isCallExpression(node)) {
        assert.notEqual(node.expression.kind,ts.SyntaxKind.ImportKeyword);
        if(ts.isIdentifier(node.expression)) assert.notEqual(node.expression.text,"require");
      }
      ts.forEachChild(node,visit);
    };
    visit(source); assert.deepEqual(seen.sort(),[...allowed].sort());
  }
});
