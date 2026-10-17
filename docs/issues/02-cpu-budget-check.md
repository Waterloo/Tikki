# 02 · CPU budget check in CI

**Type:** AFK
**Labels:** `ready-for-agent`

## Parent

[docs/PRD.md](../PRD.md)

## What to build

A CI job that proves every route stays inside the Workers Free plan. After each staging deploy, the job sends a fixed set of requests to every route (web shell, REST, MCP, OAuth endpoints), reads the CPU time of each request from Workers Logs, and fails when any route uses more than 5 ms CPU.

New routes must be added to the request set. The job output lists each route with its CPU time, so a regression is easy to find.

## Acceptance criteria

- [ ] The job runs after each staging deploy and reports CPU time for each route.
- [ ] The job fails when a route goes above 5 ms, and names the route.
- [ ] The routes from issue 01 are covered.
- [ ] The README for contributors says how to add a route to the check.

## Blocked by

- [01 · Walking skeleton](01-walking-skeleton.md)
