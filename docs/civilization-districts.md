# Civilization Districts

The settlement is organized into **20 districts** (`DISTRICTS` in
`src/civilization/settlementTypes.ts`), each a standing responsibility area that
*publishes capability demand* rather than receiving worker assignments. Ants
volunteer against demand; districts never push work onto specific ants.

## The districts

| District | Responsibility |
| --- | --- |
| `queen-continuity` | Persistence / continuity of the settlement (no worker command) |
| `academy` | Training, evaluation, promotion evidence |
| `research` | Investigation and option-finding |
| `architecture-council` | System-shape decisions and policy |
| `software-engineering` | General implementation |
| `frontend-guild` | UI-facing work |
| `backend-guild` | Service / API work |
| `database-guild` | Data and repository work |
| `ai-agent-engineering` | Agent / provider integration work |
| `testing-quality` | Test authorship and quality gates |
| `debugging-repair` | Defect diagnosis and repair |
| `defensive-security` | Security findings and review |
| `devops-infrastructure` | Build / verification infrastructure |
| `knowledge-memory` | Knowledge capture and validation |
| `tool-mcp` | MCP tool permissioning and calls |
| `provider-compute` | Provider-cognition capacity |
| `operations-command` | Command-center projection |
| `waste-recycling` | Failure recycling / waste economy |
| `reserve-worker` | Standby capacity |
| `brood-development` | New-worker maturation |

## In the live run

`createDistricts()` builds all 20; `publishDistrictDemand(...)` emits demand for
each. During a live mission the relevant districts (`software-engineering`,
`testing-quality`, `defensive-security`, `tool-mcp`, `provider-compute`,
`debugging-repair`, `knowledge-memory`) shape which capabilities the councils
approve and which the voluntary cohort claims — but the mapping from an admitted
ant to its district is derived from the ant's own claim, so
`nonVolunteerAssignments` stays 0. See
[Civilization Live Run](civilization-live-run.md).
