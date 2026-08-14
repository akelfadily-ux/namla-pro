/**
 * FakeWorkspaceDriver: an in-memory WorkspaceDriver. Used by
 * demoRealCognitiveColony.ts and every automated test — no real filesystem
 * write ever happens through this driver. Mirrors the injected-fake-driver
 * discipline demoC2ExclusiveCreateSimulation.ts already established for
 * Capability C2-B (`realNodeDriverInvocationCount: 0`).
 */

import type { WorkspaceDriver } from "./missionWorkspaceTypes";

export class FakeWorkspaceDriver implements WorkspaceDriver {
  private readonly files = new Map<string, string>();
  private writeCount = 0;

  write(relativePath: string, content: string): void {
    this.files.set(relativePath, content);
    this.writeCount += 1;
  }

  read(relativePath: string): string | undefined {
    return this.files.get(relativePath);
  }

  list(): readonly string[] {
    return [...this.files.keys()].sort();
  }

  get realFilesystemWriteCount(): 0 {
    return 0;
  }

  get fakeWriteCount(): number {
    return this.writeCount;
  }
}
