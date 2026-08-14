# Civilization Councils

Councils are the settlement's **policy quorum** mechanism
(`conveneCouncil` in `src/civilization/councilsGovernance.ts`). A council decides
*policy and capability categories* — it never assigns work to a specific ant.
Every council session records a decision, its supporting quorum, and any
**minority reports** (dissent is preserved, not suppressed).

## The five standing councils of a live mission

1. **architecture** — approves the shape of the objective's solution.
2. **security** — reviews high-risk findings raised by the defensive-security district (convened a second time when a finding lands).
3. **quality** — sets the quality / test bar.
4. **tool-permission** — approves the *powerful MCP capability category* (e.g. workspace-file-create, verification) as a category, never per ant. Its `decisionSupported` gates whether powerful tool grants are `humanApproved`.
5. **knowledge-validation** — validates knowledge before it enters the national knowledge base.

An **incident council** is additionally convened when verification fails (see
[Incident & Repair](civilization-incident-repair.md)).

## Guarantees

- `councilsActivated` ≥ 5 (6 when a security finding lands).
- Councils approve capability categories; `queenTaskAssignments`,
  `tamaraDirectAntAssignments`, and `globalPlannerDecisions` stay 0.
- `minorityReports` ≥ 1 — dissent is always recorded.
- The tool-permission council's decision is the only gate that marks a powerful
  MCP grant human-approved; without support, powerful tools are not granted.
