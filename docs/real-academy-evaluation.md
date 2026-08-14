# Real academy evaluation

Build Law §21. Every real provider result in a pilot is evaluated **by a
different ant than the student** (`realAcademyPilot.ts` selects an evaluator with
`evaluatorAntId !== studentAntId` and sufficient verified reliability). The
evaluator receives the provider result as DATA and checks correctness, safety,
rubric compliance, evidence, test quality, hallucination risk, and workspace
boundary. It may pass, fail, or request remediation.

## Evidence, not authority

A single provider response can never directly promote or certify an ant. Results
update only bounded SkillPassport evidence through the existing evidence-gated
academy rules (`recordExamEvidence`, which refuses self-grading). Promotion
requires accumulated evidence across multiple missions; **certification is
impossible from one pilot** (`certificationsGranted` is literal 0). A failed
evaluation records a failure pattern and moves the ant into remediation; the ant
keeps its identity.

## In the demo

Of the 5-ant cohort, 3 produce completed results, evaluated independently: 2
pass, 1 fails (a low-confidence "weak success"), driving a remediation. The two
provider failures (quota, malformed) also fall back to deterministic remediation.
No promotion or certification is granted from the pilot.
