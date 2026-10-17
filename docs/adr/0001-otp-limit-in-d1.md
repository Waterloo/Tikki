# 0001 · The sign-in code limit uses a D1 counter

**Status:** Accepted, 2026-10-18 (issue 01)

## Context

DECISIONS.md section 10 sets a limit of 5 email codes an hour for each address. It says: use the Cloudflare rate-limiting binding if the Free plan has it, else use a counter in D1.

The Workers rate-limiting binding accepts a period of 10 or 60 seconds only. It cannot count over one hour.

## Decision

The table `otp_request` records each code request (address and time). A Better-Auth `before` hook on `/email-otp/send-verification-otp` counts the rows for the address in the last hour. The 6th request gets `429 TOO_MANY_CODE_REQUESTS`, and no email is sent. The same hook deletes the rows of that address that are older than one hour.

The address is compared in lowercase. Better-Auth's own IP rate limiter is off; the per-IP limit for sign-in comes in issue 23.

## Consequences

- Each code request costs one D1 read and one D1 batch write. This is wall time, not CPU time.
- The limit is exact across isolates, because D1 is the one shared store.
