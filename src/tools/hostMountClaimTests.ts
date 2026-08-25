/**
 * hostMountClaimTests — the host-mount guarantee must say what it can prove
 * (SANDBOX-R0K).
 *
 * THE DEFECT. The claim was named `noHostFilesystemMounts` and its entire
 * evidence was `HOST_MARKERS.every(m => !existsSync(m))` over six paths. Two
 * separate problems:
 *
 *   1. The name was FALSE BY DESIGN. The sandbox deliberately bind-mounts
 *      /workspace, /namla-probe and /src-readonly from the host, so "no host
 *      filesystem mounts" could never be true of a working sandbox.
 *   2. A six-item denylist proves only that those six paths were absent. A
 *      seventh, unpredicted bind mount would have passed unnoticed.
 *
 * THE REPAIR. The claim is `onlyApprovedHostMounts`, and the evidence is
 * COMPOSITE: a runtime ENUMERATION of the container mount table (the observed
 * target set must be a subset of the approved mounts plus the container
 * runtime's own), the six-marker denylist as supplementary evidence, and
 * host-side canonical validation of every mount SOURCE.
 *
 * WHY COMPOSITE AND NOT PURELY RUNTIME. Measured on Docker Desktop: a Windows
 * bind appears as `9p` whose source is the whole drive share (`aname=drvfs`),
 * not the specific host directory. The container cannot attribute the Windows
 * source, so source identity is proven host-side and target/type/ro is proven in
 * the container. Neither half alone is sufficient, and the claim is categorised
 * accordingly rather than being called runtime-proven.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateMountInventory, APPROVED_APPLICATION_MOUNTS } from "./containerIsolationProbe";
import { classifyProbe, buildContainerRunArgs, FORBIDDEN_DOCKER_FLAGS, CONTAINER_WORKSPACE_MOUNT, CONTAINER_SOURCE_MOUNT, CONTAINER_PROBE_MOUNT, type ProbeFindings } from "../cognitive/containerSandboxBackend";
import { validateMountSource, type CanonicalMountSource } from "../cognitive/safeMountSource";
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

/**
 * A REAL mount table, captured verbatim from the approved image running under
 * Docker Desktop. Using the genuine text rather than an invented one means the
 * parser is exercised against the shape it will actually meet, including the 9p
 * bind and the per-container /proc and /sys overlays.
 */
const REAL_MOUNTS = [
  "overlay / overlay ro,relatime,lowerdir=/var/lib/desktop-containerd/x:/y,upperdir=/z,workdir=/w 0 0",
  "proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0",
  "tmpfs /dev tmpfs rw,nosuid,size=65536k,mode=755 0 0",
  "devpts /dev/pts devpts rw,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=666 0 0",
  "sysfs /sys sysfs ro,nosuid,nodev,noexec,relatime 0 0",
  "cgroup /sys/fs/cgroup cgroup2 ro,nosuid,nodev,noexec,relatime 0 0",
  "mqueue /dev/mqueue mqueue rw,nosuid,nodev,noexec,relatime 0 0",
  "shm /dev/shm tmpfs rw,nosuid,nodev,noexec,relatime,size=65536k 0 0",
  "tmpfs /tmp tmpfs rw,nosuid,nodev,noexec,relatime,size=65536k 0 0",
  "C:\\134 /workspace 9p rw,noatime,aname=drvfs;path=C:\\ 0 0",
  "C:\\134 /namla-probe 9p ro,noatime,aname=drvfs;path=C:\\ 0 0",
  "C:\\134 /src-readonly 9p ro,noatime,aname=drvfs;path=C:\\ 0 0",
  "/dev/sdd /etc/resolv.conf ext4 ro,relatime 0 0",
  "/dev/sdd /etc/hostname ext4 ro,relatime 0 0",
  "/dev/sdd /etc/hosts ext4 ro,relatime 0 0",
  "proc /proc/bus proc ro,nosuid,nodev,noexec,relatime 0 0",
  "tmpfs /proc/acpi tmpfs ro,relatime,size=4k,nr_inodes=1 0 0",
  "tmpfs /sys/firmware tmpfs ro,relatime,size=4k,nr_inodes=1 0 0",
].join("\n");

function findings(over: Partial<ProbeFindings> = {}): ProbeFindings {
  return {
    uid: 10001, uidNonRoot: true, sensitiveHostMarkersAbsent: true,
    unexpectedApplicationMounts: [],
    dockerSocketAbsent: true, secretsAbsent: true, pidNamespaceIsolated: true,
    rootFilesystemReadOnly: true, writeOutsideWorkspaceFails: true,
    sourceMountPresent: true, sourceMountReadable: true, sourceMountWriteDenied: true, sourceMountReadOnly: true,
    workspaceWritable: true, memoryLimitBytes: 536870912, cpuLimitConfigured: true, pidLimit: 64, networkDenied: true,
    ...over,
  } as ProbeFindings;
}

const FIXTURE_ROOT = realpathSync(mkdtempSync(resolve(tmpdir(), "namla-mountclaim-")));
function provenSource(name: string): CanonicalMountSource {
  const dir = join(FIXTURE_ROOT, name);
  mkdirSync(dir, { recursive: true });
  const r = validateMountSource(dir, [FIXTURE_ROOT], "workspace");
  if (!r.ok) throw new Error(`fixture ${name}: ${r.reasonCode}`);
  return r.canonicalPath;
}
const WS = provenSource("ws");
const PROBE = provenSource("probe");
const SRC = provenSource("src");

// ---------------------------------------------------------------------------
// 1. The approved set is recognised, and system mounts are NOT violations.
// ---------------------------------------------------------------------------
test("1: the real mount table yields exactly the approved application mounts", () => {
  const inv = evaluateMountInventory(REAL_MOUNTS);
  assert.deepEqual([...inv.unexpected], [], "a correct sandbox has no unexpected mounts");
  for (const approved of APPROVED_APPLICATION_MOUNTS) {
    assert.equal(inv.targets.includes(approved), true, `${approved} must be observed`);
  }
  // Container-runtime mounts must NOT be misreported as host exposure.
  for (const sys of ["/", "/proc", "/sys", "/dev", "/tmp", "/dev/shm", "/sys/fs/cgroup", "/etc/resolv.conf", "/proc/acpi"]) {
    assert.equal(inv.unexpected.includes(sys), false, `${sys} is a runtime mount, not a violation`);
  }
});

// ---------------------------------------------------------------------------
// 2. ENUMERATION, not a denylist: an unpredicted target is caught.
// ---------------------------------------------------------------------------
test("2: an unexpected bind mount is detected even though nobody predicted it", () => {
  for (const rogue of ["/host-data", "/mnt/secrets", "/opt/company", "/var/run/docker.sock", "/home/victim"]) {
    const inv = evaluateMountInventory(`${REAL_MOUNTS}\n/dev/x ${rogue} 9p rw,relatime 0 0`);
    assert.deepEqual([...inv.unexpected], [rogue], `${rogue} must be reported as unexpected`);
    assert.equal(classifyProbe(findings({ unexpectedApplicationMounts: [rogue] })), "sandbox-host-mount-detected", `${rogue} must refuse verification`);
  }
});

test("2b: host root mounted anywhere unapproved is caught", () => {
  const inv = evaluateMountInventory(`${REAL_MOUNTS}\nC:\\134 /hostroot 9p rw,relatime 0 0`);
  assert.deepEqual([...inv.unexpected], ["/hostroot"]);
});

// ---------------------------------------------------------------------------
// 3. The six-marker denylist alone can NOT carry the guarantee.
// ---------------------------------------------------------------------------
test("3: markers-absent is not sufficient on its own", () => {
  // Exactly the old evidence shape: markers absent, but a rogue mount present.
  const verdict = classifyProbe(findings({ sensitiveHostMarkersAbsent: true, unexpectedApplicationMounts: ["/rogue"] }));
  assert.equal(verdict, "sandbox-host-mount-detected", "markers absent must not excuse an unexpected mount");
  // And the denylist still contributes: markers present refuses too.
  assert.equal(classifyProbe(findings({ sensitiveHostMarkersAbsent: false })), "sandbox-host-mount-detected");
});

test("3b: an unreadable mount table refuses rather than passing empty", () => {
  // The probe substitutes a sentinel when /proc/mounts cannot be read, so the
  // failure surfaces as an unexpected mount rather than as a clean empty list.
  assert.equal(classifyProbe(findings({ unexpectedApplicationMounts: ["<mount-table-unreadable>"] })), "sandbox-host-mount-detected");
  // A MISSING field is refused too - absence is never evidence.
  const legacy = findings();
  delete (legacy as Record<string, unknown>).unexpectedApplicationMounts;
  assert.equal(classifyProbe(legacy), "sandbox-host-mount-detected", "a payload without the inventory is refused, not assumed");
});

// ---------------------------------------------------------------------------
// 4. Parsing is not fooled by escaped or malformed lines.
// ---------------------------------------------------------------------------
test("4: octal-escaped targets are decoded before comparison", () => {
  // /proc/mounts encodes a space as \040. Without decoding, "/host data" would
  // compare as a different string and could be missed.
  const inv = evaluateMountInventory("/dev/x /host\\040data ext4 rw 0 0");
  assert.deepEqual([...inv.unexpected], ["/host data"], "the decoded target is what must be compared");
  // Malformed lines are skipped, not treated as approved.
  const inv2 = evaluateMountInventory("garbage\n\n/dev/y /rogue ext4 rw 0 0");
  assert.deepEqual([...inv2.unexpected], ["/rogue"]);
});

// ---------------------------------------------------------------------------
// 5. HOST-SIDE half: the argv mount set is closed.
// ---------------------------------------------------------------------------
test("5: the generated argv carries only the approved mounts and no escape flag", () => {
  const argv = buildContainerRunArgs({
    userIdentity: { uid: 10001, gid: 10001 },
    workspaceHostPath: WS, sourceHostPath: SRC, probeHostPath: PROBE,
    cpuLimit: 1, memoryLimitMb: 512, pidLimit: 64, timeoutSeconds: 60,
    imageRef: "namla-sandbox:v1", networkMode: "none", containerName: "n",
    command: ["node", "-e", "0"],
  });
  const mountArgs = argv.filter((a) => a.startsWith("type=bind"));
  assert.equal(mountArgs.length, 3, "exactly three bind mounts, no more");
  const targets = mountArgs.map((m) => (m.match(/target=([^,]+)/) ?? [])[1]);
  assert.deepEqual(targets.sort(), [CONTAINER_PROBE_MOUNT, CONTAINER_SOURCE_MOUNT, CONTAINER_WORKSPACE_MOUNT].sort());
  // Modes are as intended: workspace writable, source and probe read-only.
  assert.equal(mountArgs.find((m) => m.includes(CONTAINER_WORKSPACE_MOUNT))?.includes("readonly=false"), true);
  assert.equal(mountArgs.find((m) => m.includes(CONTAINER_SOURCE_MOUNT))?.includes("readonly=true"), true);
  assert.equal(mountArgs.find((m) => m.includes(CONTAINER_PROBE_MOUNT))?.includes("readonly=true"), true);
  // No escape hatch may appear.
  for (const flag of FORBIDDEN_DOCKER_FLAGS) assert.equal(argv.includes(flag), false, `${flag} must never appear`);
  assert.equal(argv.some((a) => /docker\.sock/.test(a)), false, "no Docker socket mount");
  assert.equal(argv.includes("-v"), false, "no arbitrary -v");
  assert.equal(argv.includes("--volumes-from"), false);
});

// ---------------------------------------------------------------------------
// 6. HOST-SIDE half: a redirected or escaping source is rejected before argv.
// ---------------------------------------------------------------------------
test("6: a mount source outside the authorized roots is refused", () => {
  const outside = realpathSync(mkdtempSync(resolve(tmpdir(), "namla-outside-")));
  const r = validateMountSource(outside, [FIXTURE_ROOT], "workspace");
  assert.equal(r.ok, false, "an unrelated source must be refused");
  assert.equal(r.reasonCode, "sandbox-mount-source-outside-root");
  // And a junction that escapes is refused on the RESOLVED path, where the
  // container-side inventory could never see the difference.
  const linkRoot = realpathSync(mkdtempSync(resolve(tmpdir(), "namla-link-")));
  mkdirSync(join(outside, "payload"), { recursive: true });
  let linked = false;
  try {
    symlinkSync(outside, join(linkRoot, "link"), "junction");
    linked = true;
  } catch {
    linked = false;
  }
  if (linked) {
    const via = validateMountSource(join(linkRoot, "link", "payload"), [linkRoot], "workspace");
    assert.equal(via.ok, false, "a junction-escaping source must be refused");
    assert.equal(via.reasonCode, "sandbox-mount-source-outside-root");
  }
});

// ---------------------------------------------------------------------------
// 7. The approved set is Namla-owned.
// ---------------------------------------------------------------------------
test("7: the approved mount set is fixed and matches the backend constants", () => {
  assert.deepEqual([...APPROVED_APPLICATION_MOUNTS].sort(), [CONTAINER_PROBE_MOUNT, CONTAINER_SOURCE_MOUNT, CONTAINER_WORKSPACE_MOUNT].sort(), "probe-side and backend-side mount targets must not drift");
  const saved = process.env.NAMLA_APPROVED_MOUNTS;
  process.env.NAMLA_APPROVED_MOUNTS = "/anything";
  try {
    assert.deepEqual([...evaluateMountInventory(`${REAL_MOUNTS}\n/dev/x /anything ext4 rw 0 0`).unexpected], ["/anything"], "no environment variable may widen the approved set");
  } finally {
    if (saved === undefined) delete process.env.NAMLA_APPROVED_MOUNTS;
    else process.env.NAMLA_APPROVED_MOUNTS = saved;
  }
});
