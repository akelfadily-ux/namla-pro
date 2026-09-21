import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, parse } from "node:path";
import { PermissionDeniedError } from "../domain/errors";
import type { PermissionRequest, GitOperation } from "../domain/types";
import { PolicyEngine, ProductizationPolicyRefusal, canonicalizePath, PRODUCTIZATION_POLICY_VERSION } from "../application/policy-engine";
import { resolveWorkspacePath } from "../v2/kernel/workspacePathAuthority";

function refused(fn: () => unknown, reason?: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof ProductizationPolicyRefusal);
    assert.ok(error instanceof PermissionDeniedError);
    assert.equal(error.code, "PERMISSION_DENIED");
    assert.equal(error.retryable, false);
    if (reason) assert.equal(error.reasonCode, reason);
    return true;
  });
}
function withWorkspace(fn: (root: string, outer: string) => void): void {
  const outer = mkdtempSync(join(tmpdir(), "namla-c5-policy-"));
  const root = join(outer, "workspace");
  mkdirSync(join(root, "src", "nested"), {recursive:true});
  writeFileSync(join(root, "src", "item.txt"), "fixture");
  mkdirSync(join(outer, "outside"));
  writeFileSync(join(outer, "outside", "sentinel.txt"), "unchanged");
  try {
    fn(root, outer);
    assert.equal(readFileSync(join(outer, "outside", "sentinel.txt"), "utf8"), "unchanged");
  } finally { rmSync(outer, {recursive:true,force:true}); }
}
const request = (resource: string, capability = "tool:filesystem.read"): PermissionRequest => ({capability,resource});
const policy = (...permissions: string[]) => ({permissions});
const gitRequest = (gitOperation: GitOperation, capability = "tool:git"): PermissionRequest => ({capability,gitOperation});
const linkDirectory = (source: string, target: string): void => symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");

test("C5 exact capability grants retain entitlement matching without a permit", () => {
  const engine = new PolicyEngine();
  assert.equal(engine.authorize(policy("model.generate"), {capability:"model.generate"}), undefined);
  refused(() => engine.authorize(policy("model.generate"), {capability:"model.train"}), "CAPABILITY_DENIED");
  assert.equal(PRODUCTIZATION_POLICY_VERSION, 2);
});
test("C5 empty grants deny while scoped namespace grants match complete boundaries", () => {
  const engine = new PolicyEngine();
  refused(() => engine.authorize(policy(), {capability:"model.generate"}));
  engine.authorize(policy("model.*"), {capability:"model.generate"});
  engine.authorize(policy("model:*"), {capability:"model:generate"});
  refused(() => engine.authorize(policy("model.*"), {capability:"modelish.generate"}));
  refused(() => engine.authorize(policy("model.*"), {capability:"model"}));
  refused(() => engine.authorize(policy("model*"), {capability:"model.generate"}));
});
test("C5 wildcard grants cannot make raw shell or GitHub execution admissible", () => {
  const engine = new PolicyEngine();
  for (const cap of ["shell","shell.exec","shell:exec","tool:shell","tool:shell.exec","tool:shell:exec",
    "command","tool:command.execute","process.spawn","exec","docker.build","tool:docker","github.pr.merge","tool:github"]) {
    refused(() => engine.authorize(policy("*"), {capability:cap,resource:"git merge main"}), "RAW_EXECUTION_NOT_SUPPORTED");
  }
});
test("C5 absence of a forbidden text indicator never authorizes a raw command", () => {
  const engine = new PolicyEngine();
  for (const command of ["echo information","git status","node --version","docker build -t verify .","npm test"]) {
    refused(() => engine.authorize(policy("tool:shell"), {capability:"tool:shell",resource:command}), "RAW_EXECUTION_NOT_SUPPORTED");
  }
});
test("C5 shell wrappers separators and encoded command fixtures remain inert refused text", () => {
  const engine = new PolicyEngine();
  for (const command of ["git -c alias.x=merge x main","env git merge main","/usr/bin/git rebase main",
    "git status && git merge main","powershell -EncodedCommand Z2l0IG1lcmdl","g`it me`rge main","git\tmerge main"]) {
    refused(() => engine.authorize(policy("*"), {capability:"tool:shell",resource:command}));
  }
});
test("C5 raw Git is refused even when paired with a harmless structured descriptor", () => {
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    refused(() => engine.authorize(policy("*"), {capability:"tool:git",resource:"git merge main",gitOperation:{kind:"status"}}));
    refused(() => engine.authorize(policy("*"), {capability:"git",resource:"git status"}));
  });
});
test("C5 the Git descriptor embedded in PermissionRequest cannot be ignored", () => {
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    for (const action of ["pull","merge","rebase","cherry-pick","am"] as const) {
      refused(() => engine.authorize(policy("*"), gitRequest({kind:"forbidden",action})), "HUMAN_ONLY_GIT");
    }
  });
});
test("C5 the legacy third Git argument retains the human-only denial", () => {
  const engine = new PolicyEngine();
  for (const action of ["pull","merge","rebase","cherry-pick","am"] as const) {
    refused(() => engine.authorize(policy("*"), {capability:"git"}, {kind:"forbidden",action}), "HUMAN_ONLY_GIT");
  }
});
test("C5 two contradictory Git descriptors are refused instead of choosing one", () => {
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    refused(() => engine.authorize(policy("*"), gitRequest({kind:"status"}), {kind:"log"}), "GIT_BINDING_MISMATCH");
    refused(() => engine.authorize(policy("*"), gitRequest({kind:"status"}), {kind:"forbidden",action:"merge"}), "HUMAN_ONLY_GIT");
    engine.authorize(policy("tool:git"), gitRequest({kind:"log",count:5}), {kind:"log",count:5});
  });
});
test("C5 structured read-only Git requires a bound workspace and matching entitlement", () => {
  refused(() => new PolicyEngine().authorize(policy("*"), gitRequest({kind:"status"})), "WORKSPACE_REQUIRED");
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    for (const operation of [{kind:"status"},{kind:"log",count:10},{kind:"diff",target:"a".repeat(40)}] as const) {
      engine.authorize(policy("tool:git"), gitRequest(operation));
      refused(() => engine.authorize(policy(), gitRequest(operation)), "CAPABILITY_DENIED");
    }
    refused(() => engine.authorize(policy("*"), {capability:"tool:git"}), "GIT_DESCRIPTOR_REQUIRED");
  });
});
test("C5 action-scoped Git capabilities must agree with the typed request", () => {
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    engine.authorize(policy("git:*"), gitRequest({kind:"status"}, "git:status"));
    engine.authorize(policy("tool:git.*"), gitRequest({kind:"diff"}, "tool:git.diff"));
    refused(() => engine.authorize(policy("*"), gitRequest({kind:"status"}, "git.merge")), "GIT_BINDING_MISMATCH");
    refused(() => engine.authorize(policy("*"), gitRequest({kind:"status"}, "model.generate")), "GIT_BINDING_MISMATCH");
  });
});
test("C5 Git writes await branch-bound execution instead of assuming permission", () => {
  const engine = new PolicyEngine();
  for (const operation of [{kind:"commit",message:"checkpoint"},{kind:"branch",name:"work"},{kind:"checkout",branch:"main"}] as const) {
    refused(() => engine.authorizeGitOperation(operation), "GIT_WRITE_BINDING_REQUIRED");
    refused(() => engine.authorize(policy("*"), gitRequest(operation)), "GIT_WRITE_BINDING_REQUIRED");
  }
});
test("C5 unknown forged or malformed Git discriminants never pass admission", () => {
  const engine = new PolicyEngine();
  for (const operation of [null,{},"status",{kind:"merge"},{kind:"push"},{kind:"STATUS"},{kind:"status",action:"merge"}]) {
    refused(() => engine.authorizeGitOperation(operation as GitOperation));
  }
});
test("C5 Git log limits and pinned diff identities reject coercion and option text", () => {
  const engine = new PolicyEngine();
  for (const count of [0,-1,1.5,NaN,Infinity,"5",1001]) refused(() => engine.authorizeGitOperation({kind:"log",count} as GitOperation));
  for (const target of ["main","--output=leak","a;echo x","a".repeat(39),"F".repeat(40),1]) {
    refused(() => engine.authorizeGitOperation({kind:"diff",target} as GitOperation));
  }
  engine.authorizeGitOperation({kind:"log",count:1});
  engine.authorizeGitOperation({kind:"log",count:1000});
  engine.authorizeGitOperation({kind:"diff",target:"0".repeat(64)});
});
test("C5 Git descriptor validation produces neither a permission nor filesystem effects", () => {
  const engine = new PolicyEngine();
  assert.equal(engine.authorizeGitOperation({kind:"status"}), undefined);
  assert.equal(engine.authorizeGitOperation({kind:"diff"}), undefined);
  refused(() => engine.authorize(policy(), gitRequest({kind:"status"})));
});
test("C5 filesystem requests require an explicit existing trusted root even under wildcard", () => {
  refused(() => new PolicyEngine().authorize(policy("*"), request("src/item.txt")), "WORKSPACE_REQUIRED");
  refused(() => canonicalizePath("src/item.txt"), "WORKSPACE_REQUIRED");
  withWorkspace((root,outer) => {
    refused(() => new PolicyEngine({workspaceRoot:join(outer,"absent")}));
    assert.equal(existsSync(join(outer,"absent")), false);
    refused(() => new PolicyEngine({workspaceRoot:join(root,"src","item.txt")}));
    refused(() => new PolicyEngine({workspaceRoot:"relative-root"}));
    refused(() => new PolicyEngine({workspaceRoot:parse(root).root}));
    mkdirSync(join(root,".git"));
    refused(() => new PolicyEngine({workspaceRoot:join(root,".git")}));
  });
});
test("C5 legitimate existing and not-yet-existing resource paths reuse V2 resolution", () => {
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    for (const name of ["src/item.txt","src/nested/new.txt","new/deep/item.txt"]) {
      engine.authorize(policy("tool:filesystem.read"), request(name));
      assert.equal(canonicalizePath(name,root),resolveWorkspacePath(root,name).absolutePath);
    }
    assert.equal(existsSync(join(root,"new")), false);
  });
});
test("C5 absolute resource paths must still remain in the separately configured root", () => {
  withWorkspace((root,outer) => {
    const engine = new PolicyEngine({workspaceRoot:root});
    engine.authorize(policy("*"),request(join(root,"src","item.txt")));
    refused(() => engine.authorize(policy("*"),request(join(outer,"outside","sentinel.txt"))),"PATH_REFUSED");
    refused(() => engine.authorize(policy("*"),request(root+"-evil/item.txt")),"PATH_REFUSED");
  });
});
test("C5 exact filesystem grants distinguish operations and sibling file names", () => {
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    const grants=policy("tool:filesystem.read:src/item.txt");
    engine.authorize(grants,request("src/item.txt"));
    refused(() => engine.authorize(grants,request("src/item.txt-evil")),"CAPABILITY_DENIED");
    refused(() => engine.authorize(grants,request("src/item.txt","tool:filesystem.write")),"CAPABILITY_DENIED");
  });
});
test("C5 a single-star path grants immediate children but not nested descendants", () => {
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    engine.authorize(policy("tool:filesystem.read:src/*"),request("src/item.txt"));
    refused(() => engine.authorize(policy("tool:filesystem.read:src/*"),request("src/nested/item.txt")),"CAPABILITY_DENIED");
    refused(() => engine.authorize(policy("tool:filesystem.read:src/*"),request("src")),"CAPABILITY_DENIED");
  });
});
test("C5 a double-star path grants strict descendants without sibling-prefix collisions", () => {
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    engine.authorize(policy("tool:filesystem.read:src/**"),request("src/nested/item.txt"));
    refused(() => engine.authorize(policy("tool:filesystem.read:src/**"),request("src-evil/item.txt")),"CAPABILITY_DENIED");
    refused(() => engine.authorize(policy("tool:filesystem.read:src/**"),request("src")),"CAPABILITY_DENIED");
  });
});
test("C5 resource all-scopes stay inside the root and never become host-wide grants", () => {
  withWorkspace((root,outer) => {
    const engine = new PolicyEngine({workspaceRoot:root});
    for (const grant of ["*","tool:*","tool:filesystem.*","tool:filesystem.read:*","tool:filesystem.read:**"]) {
      engine.authorize(policy(grant), request("src/item.txt"));
      refused(() => engine.authorize(policy(grant),request(join(outer,"outside","sentinel.txt"))));
    }
  });
});
test("C5 absolute scoped grants bind paths inside the configured root only", () => {
  withWorkspace((root,outer) => {
    const engine = new PolicyEngine({workspaceRoot:root});
    engine.authorize(policy("tool:filesystem.read:"+join(root,"src")+"/**"), request("src/item.txt"));
    refused(() => engine.authorize(policy("tool:filesystem.read:"+join(outer,"outside")+"/**"),request("src/item.txt")));
  });
});
test("C5 parent traversal is refused before absolute-path normalization can erase it", () => {
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    for (const name of ["../outside/sentinel.txt","src/../item.txt","src\\..\\item.txt",root+"/src/../item.txt"]) {
      refused(() => engine.authorize(policy("*"),request(name)),"PATH_REFUSED");
    }
  });
});
test("C5 ambiguous encoded device UNC alternate-stream and control paths are refused", () => {
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    for (const name of ["src/%2e%2e/item","//host/share/item","\\\\host\\share\\item","C:relative",
      "src/item:stream","src/aux.txt","src/nul","src/item.","src/item ","src//item","src/./item","src/*","src/\u0000item"]) {
      refused(() => engine.authorize(policy("*"),request(name)));
    }
  });
});
test("C5 repository metadata cannot be written through wildcard filesystem grants", () => {
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    for (const name of [".git",".git/config",".GIT/refs/heads/main","src/.git/hooks/pre-commit"]) {
      refused(() => engine.authorize(policy("*"),request(name,"tool:filesystem.write")),"PATH_REFUSED");
    }
    engine.authorize(policy("*"),request("src/git-notes.txt"));
  });
});
test("C5 directory symlink or junction escapes are refused before scoped matching", () => {
  withWorkspace((root,outer) => {
    linkDirectory(join(outer,"outside"),join(root,"src","out-link"));
    const engine = new PolicyEngine({workspaceRoot:root});
    refused(() => engine.authorize(policy("*"),request("src/out-link/sentinel.txt")),"PATH_REFUSED");
    refused(() => engine.authorize(policy("*"),request("src/out-link/not-yet-created.txt")),"PATH_REFUSED");
  });
});
test("C5 even in-root directory aliases are refused rather than weakening resource scopes", () => {
  withWorkspace(root => {
    linkDirectory(join(root,"src","nested"),join(root,"alias"));
    const engine = new PolicyEngine({workspaceRoot:root});
    refused(() => engine.authorize(policy("*"),request("alias/new.txt")),"PATH_REFUSED");
    refused(() => engine.authorize(policy("tool:filesystem.read:alias/**"),request("src/nested/new.txt")),"PATH_REFUSED");
  });
});
test("C5 dangling links or junctions are not treated as ordinary missing directories", () => {
  withWorkspace((root,outer) => {
    const destination=join(outer,"disappearing"); mkdirSync(destination);
    linkDirectory(destination,join(root,"src","dangling")); rmSync(destination,{recursive:true});
    const engine = new PolicyEngine({workspaceRoot:root});
    refused(() => engine.authorize(policy("*"),request("src/dangling/new.txt")),"PATH_REFUSED");
  });
});
test("C5 a symlink or junction cannot itself become the configured root", () => {
  withWorkspace((root,outer) => {
    linkDirectory(root,join(outer,"root-link"));
    refused(() => new PolicyEngine({workspaceRoot:join(outer,"root-link")}),"PATH_REFUSED");
  });
});
test("C5 replacement or disappearance of the bound root causes refusal", () => {
  withWorkspace((root,outer) => {
    const engine = new PolicyEngine({workspaceRoot:root});
    const moved=join(outer,"saved-root"); renameSync(root,moved);
    refused(() => engine.authorize(policy("*"),request("new.txt")));
    mkdirSync(root);
    refused(() => engine.authorize(policy("*"),request("new.txt")),"WORKSPACE_CHANGED");
  });
});
test("C5 ordinary files cannot masquerade as ancestor directories", () => {
  withWorkspace(root => {
    refused(() => new PolicyEngine({workspaceRoot:root}).authorize(policy("*"),request("src/item.txt/child")),"PATH_REFUSED");
  });
});
test("C5 filesystem resource fields are mandatory even for unscoped entitlements", () => {
  withWorkspace(root => {
    const engine = new PolicyEngine({workspaceRoot:root});
    for (const resource of [undefined,null,0,{},"", " "]) refused(() => engine.authorize(policy("*"), {capability:"tool:filesystem.read",resource} as PermissionRequest));
    refused(() => engine.authorize(policy("*"),{capability:"filesystem",resource:"src/item.txt"}));
  });
});
test("C5 strict record and array shapes reject hidden fields sparse arrays and symbols", () => {
  const engine = new PolicyEngine(); const req={capability:"model.generate"};
  const hole: unknown[]=[]; hole.length=1;
  const hidden=Object.defineProperty({permissions:["*"]},"shadow",{value:true});
  const symbol={permissions:["*"],[Symbol("secret")]:1};
  for (const input of [null,{},[],{permissions:hole},{permissions:["*"],extra:1},hidden,symbol]) {
    refused(() => engine.authorize(input as ReturnType<typeof policy>,req));
  }
  refused(() => engine.authorize(policy("*"),{...req,extra:1} as PermissionRequest));
});
test("C5 supplied getters are rejected without executing configuration or request code", () => {
  const engine = new PolicyEngine(); let calls=0;
  const getter=()=>{ calls++; return "*"; };
  refused(() => engine.authorize(Object.defineProperty({},"permissions",{enumerable:true,get:getter}) as ReturnType<typeof policy>,{capability:"model.generate"}));
  refused(() => engine.authorize(policy("*"),Object.defineProperty({},"capability",{enumerable:true,get:getter}) as PermissionRequest));
  const values=["*"];Object.defineProperty(values,"0",{enumerable:true,get:getter});
  refused(() => engine.authorize({permissions:values},{capability:"model.generate"}));
  refused(() => engine.authorizeGitOperation(Object.defineProperty({},"kind",{enumerable:true,get:getter}) as GitOperation));
  refused(() => new PolicyEngine(Object.defineProperty({},"workspaceRoot",{enumerable:true,get:getter})));
  assert.equal(calls,0);
});
test("C5 proxies including revoked proxies are refused without reflection traps", () => {
  const engine = new PolicyEngine(); let traps=0;
  const proxy=new Proxy({permissions:["*"]},{ownKeys(){traps++;throw new Error("private");},getPrototypeOf(){traps++;return Object.prototype;}});
  refused(() => engine.authorize(proxy,{capability:"model.generate"}));
  const revoked=Proxy.revocable({kind:"status"},{});revoked.revoke();
  refused(() => engine.authorizeGitOperation(revoked.proxy as GitOperation));
  refused(() => engine.authorize({permissions:new Proxy(["*"],{})},{capability:"model.generate"}));
  assert.equal(traps,0);
});
test("C5 null-prototype data records remain supported without inherited grants", () => {
  const engine = new PolicyEngine();
  engine.authorize(Object.assign(Object.create(null),{permissions:["model.generate"]}),Object.assign(Object.create(null),{capability:"model.generate"}));
  refused(() => engine.authorize(Object.create({permissions:["*"]}),{capability:"model.generate"}));
  refused(() => engine.authorize(policy("*"),Object.create({capability:"model.generate"})));
});
test("C5 malformed capabilities and overlong inputs are rejected without coercion", () => {
  const engine = new PolicyEngine();
  for (const cap of ["*","tool:*",""," model.generate","MODEL.generate","model..generate","model/generate",123,"x".repeat(257)]) {
    refused(() => engine.authorize(policy("*"),{capability:cap} as PermissionRequest));
  }
  refused(() => engine.authorize(policy(...new Array(257).fill("*")),{capability:"model.generate"}));
  refused(() => engine.authorize(policy("*"),{capability:"model.generate",resource:"x".repeat(4097)}));
});
test("C5 every grant is validated before a preceding wildcard can short-circuit", () => {
  const engine = new PolicyEngine();
  for (const grant of ["tool:git*","model**","model.*.other","","tool:filesystem.read:src/../outside/**"]) {
    refused(() => engine.authorize(policy("*",grant),{capability:"model.generate"}));
  }
});
test("C5 caller-owned options policies and requests are neither mutated nor frozen", () => {
  withWorkspace(root => {
    const options={workspaceRoot:root};const engine=new PolicyEngine(options);
    const grants=policy("tool:filesystem.read:src/**");const req=request("src/item.txt");
    const before=JSON.stringify({options,grants,req});
    engine.authorize(grants,req);
    assert.equal(JSON.stringify({options,grants,req}),before);
    assert.equal(Object.isFrozen(grants),false);assert.equal(Object.isFrozen(req),false);
    options.workspaceRoot=join(root,"src");
    engine.authorize(grants,req);
  });
});
test("C5 revoking the supplied entitlement on the next call is not bypassed by a cache", () => {
  const engine=new PolicyEngine();const grants=policy("model.generate");const req={capability:"model.generate"};
  engine.authorize(grants,req);grants.permissions.length=0;
  refused(() => engine.authorize(grants,req),"CAPABILITY_DENIED");
});
test("C5 refusal diagnostics expose no host path command or caller exception content", () => {
  const engine=new PolicyEngine();const secret="sentinel-private-do-not-print";
  try { engine.authorize(policy("*"),{capability:"tool:shell",resource:secret});assert.fail("expected refusal"); }
  catch(error) { assert.ok(error instanceof ProductizationPolicyRefusal);assert.equal(error.message.includes(secret),false);assert.equal(error.cause,undefined); }
  try { new PolicyEngine({workspaceRoot:join(tmpdir(),secret)});assert.fail("expected refusal"); }
  catch(error) { assert.ok(error instanceof ProductizationPolicyRefusal);assert.equal(error.message.includes(secret),false); }
});
test("C5 successful file admission is not an execution lease a read or a write", () => {
  withWorkspace(root => {
    const engine=new PolicyEngine({workspaceRoot:root});const missing=join(root,"new.txt");
    assert.equal(engine.authorize(policy("tool:filesystem.write"),request(missing,"tool:filesystem.write")),undefined);
    assert.equal(existsSync(missing),false);
    assert.equal(readFileSync(join(root,"src","item.txt"),"utf8"),"fixture");
  });
});
test("C5 dependencies reuse V2 path authority without execution SDKs or a second command parser", () => {
  const source=readFileSync(resolve("src/application/policy-engine.ts"),"utf8");
  const imports=[...source.matchAll(/from\s+["']([^"']+)["']/g)].map(m=>m[1]).sort();
  assert.deepEqual(imports,["../domain/errors","../domain/types","../v2/kernel/workspacePathAuthority","node:fs","node:path","node:util"].sort());
  assert.match(source,/resolveWorkspacePath\(root\.canonical/);
  assert.equal(/(?:\brequire\s*\(|\bimport\s*\(|child_process|execSync|spawnSync|eval\s*\(|new Function)/.test(source),false);
  assert.equal(source.includes("isForbiddenCommand"),false);
});
