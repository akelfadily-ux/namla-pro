export const ISOLATED_DOCKER_BUILD_EXECUTABLE_ID = "isolated-docker-build";

export interface IsolatedDockerBuildRequest {
  readonly workspaceAbsolutePath: string;
  readonly missionId: string;
  readonly stageId: string;
  readonly imageTag: string;
  readonly timeoutMs: number;
}
export interface IsolatedDockerBuildResult {
  readonly success: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly reasonCode: string;
}
export interface IsolatedDockerBuildExecutor {
  build(request: IsolatedDockerBuildRequest): IsolatedDockerBuildResult;
}
