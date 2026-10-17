# 0003 · The MCP endpoint checks tokens against the JWKS in D1

**Status:** Accepted, 2026-10-18 (issue 01)

## Context

`requireMcpAuth` from `@better-auth/mcp` gets the JWKS with an HTTP request to `{baseURL}/jwks`. Our MCP endpoint and the authorization server are the same Worker, so this request goes from the Worker to its own hostname. That depends on Cloudflare's routing rules for subrequests to the same zone, it cannot work in the Workers test runtime (no server listens on APP_URL), and it adds a subrequest to each cold isolate.

## Decision

`server/utils/mcp.ts` calls `verifyJwsAccessToken` from `better-auth/oauth2` with a function JWKS source: `auth.api.getJwks()`, which reads the keys from D1. The result is cached for each isolate with Better-Auth's own TTL and refetch rules. The checks are the same as in `requireMcpAuth`: signature, issuer (`{APP_URL}/api/auth`), audience (the MCP URL), and expiry. The 401 response comes from `createResourceServerChallenge`, so the `WWW-Authenticate` header is the same.

A token with a `cnf` claim (DPoP-bound) is refused, because this path does not check DPoP proofs. Claude sends bearer tokens.

## Consequences

- No self-fetch. One D1 read for the keys on a cold isolate, then none until the cache expires.
- If Better-Auth changes its token checks, we must follow. The test suite covers a valid token, a bad token and a missing token.
