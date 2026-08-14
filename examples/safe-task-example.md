# Example: A Safe Task

This shows a task that passes every safety check and gets routed to an ant.

## The task

```
title: "Investigate ant role documentation"
description: "Investigate and plan for goal: Explain ant roles"
requiredRole: planner
```

## Walking through SafetyGuard

`SafetyGuard.evaluateText` scans the description for forbidden, risky, and
caution indicators (`delete`, `rm -rf`, `install`, `git push`, `sudo`, etc.).
None match. The result:

```
level: SAFE
allowed: true
reasons: []
```

## Walking through TaskRouter

`TaskRouter.route` looks for an available ant with `role: "planner"` and
`energy !== "offline"`. It finds `planner-demo-1`, currently `idle`, and
assigns the task to it.

## The receipt

```
summary: 'Task "Investigate ant role documentation" routed with status assigned.'
status: approved
links: { missionId, taskId, antId: "planner-demo-1" }
```

## The pheromone

A `TrailPheromone` is emitted so other ants can sense that work is now
happening in this direction, without needing to be told directly.

This is the "happy path" — see
[forbidden-action-example.md](./forbidden-action-example.md) for what happens
when a task fails the safety check instead.
