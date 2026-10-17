# 0002 · CIMD on Workers fetches only from allowed hosts

**Status:** Accepted, 2026-10-18 (issue 01)

## Context

`@better-auth/cimd` needs a transport that fetches Client ID Metadata Documents. The Better-Auth docs require that the transport resolves the hostname once, refuses special-use addresses, and pins the approved address for the connection. The package ships this transport only for Node.

The Workers `fetch` API cannot pin an address, so a DNS check before `fetch` does not stop DNS rebinding.

## Decision

The Workers transport (`server/utils/cimd-fetch.ts`) fetches only from an allow list of hosts: `claude.ai` and `claude.com`. It accepts HTTPS, GET and HEAD only, with no port and no credentials, and it never follows redirects. `isMetadataDocumentUrlAllowed` uses the same list, so Better-Auth refuses other client IDs before any fetch.

DCR stays on. Other MCP clients register with DCR.

## Consequences

- No server-side request can go to a host that we do not trust, so SSRF and DNS rebinding are not possible through CIMD.
- The transport must not build a `Request` from the plugin's options. The plugin passes `redirect: 'error'`, and workerd rejects that value, so every fetch failed before it reached the network (found with Claude Code on 2026-10-18; `test/worker/cimd.test.ts`).
- A new CIMD client host needs a code change. If Claude uses a host that is not in the list, the authorization fails with `invalid_client`; add the host to `CIMD_ALLOWED_HOSTS`.
