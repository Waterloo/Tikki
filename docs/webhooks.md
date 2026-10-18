# Webhooks

Tikki sends an HTTPS `POST` to your endpoint for each ticket change. Each Event has the ticket before and after the change, who made it, and a [Standard Webhooks](https://www.standardwebhooks.com/) signature.

Typical uses:

- Post new tickets and Status changes to a Slack or Teams channel (through n8n, Zapier or your own code).
- Sync the Status of a ticket back into your shop or CRM.
- Copy every change into your data warehouse.

## Quick start

1. Make a receiver that answers `204`. This one checks the signature with the `standardwebhooks` package (`npm install standardwebhooks express`):

   ```js
   import express from 'express'
   import { Webhook } from 'standardwebhooks'

   const wh = new Webhook(process.env.TIKKI_WEBHOOK_SECRET) // whsec_...
   const app = express()

   // Keep the raw body: the signature covers the exact bytes.
   app.post('/tikki', express.raw({ type: 'application/json' }), (req, res) => {
     let event
     try {
       event = wh.verify(req.body.toString('utf8'), req.headers)
     } catch {
       return res.sendStatus(401)
     }
     console.log(event.type, event.after?.ref)
     res.sendStatus(204)
   })

   app.listen(3000)
   ```

2. Make the receiver reachable on the internet with HTTPS (for example with a tunnel such as `cloudflared tunnel --url http://localhost:3000`).
3. In Tikki, an Admin opens **Webhooks**, adds the URL, and copies the signing secret. Tikki shows it once.
4. Click **Send test event**. Your receiver prints `webhook.test`.

## Two kinds of endpoint

| | Admin endpoint | Application endpoint |
|---|---|---|
| Where | The **Webhooks** page | The page of one Application |
| How many | Any number | At most one for each Application |
| Events | The ones you choose | Always `ticket.created`, `ticket.updated`, `comment.created` |
| Tickets | All tickets | Only the tickets of that Application's Contacts |
| Internal data | Internal Comments and Restricted tickets only with **Include internal data** | Never |
| Staff | Names and emails | Every Agent and Admin shows as `{ "kind": "support" }`. No assignee and no Team. |

Use an Admin endpoint for your own team's tools. Use an Application endpoint when the receiver belongs to the system that created the tickets, for example your shop.

## Events

| `type` | When | `before` | `after` |
|---|---|---|---|
| `ticket.created` | A ticket is created on the web, by an AI assistant, or through the API | `null` | The ticket |
| `ticket.updated` | Status, Priority, Ticket Type, assignee, Team, description or a Field changes. `changed` lists what changed. | The ticket | The ticket |
| `comment.created` | A comment is added. The Event also has `comment`. | The ticket | The ticket |
| `webhook.test` | An Admin clicks **Send test event** | — | — |

`changed` has `status`, `priority`, `ticket_type`, `assignee`, `team`, `description`, or the Field Key of a changed Field. An Application endpoint gets no Event when only the Team changed.

A Restricted ticket (a "Participants only" type) makes no Event for an Admin endpoint without **Include internal data**, and never for an Application endpoint.

## Payload

The body is JSON. A retry sends the same bytes.

```json
{
  "event_id": "6f1c2e0a-8d3b-4c55-9a1e-2b7f0c9d4e11",
  "type": "ticket.updated",
  "created_at": "2026-10-18T10:03:10.000Z",
  "changed": ["status"],
  "actor": { "kind": "user", "id": "u_8f2c", "name": "Sam Lee", "channel": "web" },
  "before": { "number": 1048, "ref": "PAY-1048", "status": { "key": "open", "name": "Open", "category": "open" } },
  "after": {
    "number": 1048,
    "ref": "PAY-1048",
    "title": "Charged twice for order 5521",
    "description": "I was charged two times.",
    "priority": "high",
    "status": { "key": "resolved", "name": "Resolved", "category": "done" },
    "ticket_type": { "id": 3, "name": "Payment issue", "prefix": "PAY" },
    "team": { "id": 2, "name": "Billing" },
    "requester": { "kind": "contact", "id": 77, "external_id": "cus_19ab", "name": "Jo Park", "email": "jo@example.org", "application_id": 1 },
    "assignee": { "id": "u_8f2c", "name": "Sam Lee", "email": "sam@acme.com" },
    "schema_version": 2,
    "fields": { "order_id": "5521", "amount": "49.00" },
    "channel": "api",
    "created_at": "2026-10-18T09:12:44.000Z",
    "updated_at": "2026-10-18T10:03:10.000Z"
  }
}
```

`before` is shortened here. It has the same keys as `after`.

### The actor

| `actor.kind` | Fields | Who |
|---|---|---|
| `user` | `id`, `name`, `channel`, and `ticket_app` when the change came through a Ticket App | A person in your organization |
| `application` | `id`, `name`, `channel` | An Application, through the REST API |
| `support` | — | Any staff member, in an Application endpoint's payload |

`channel` is `web`, `ai` (an AI assistant through MCP or the page tools), `api`, or `app` (a Ticket App).

### The comment

`comment.created` adds the comment:

```json
{
  "comment": {
    "id": "9b2f4c1e-7a35-4d8e-b0c6-3e1f2a9d8c47",
    "visibility": "public",
    "body": "We refunded the second charge.",
    "channel": "web",
    "author": { "kind": "user", "id": "u_8f2c", "name": "Sam Lee" },
    "created_at": "2026-10-18T10:05:00.000Z"
  }
}
```

A comment that an Application wrote through the API has the author `{ "kind": "application", "id": 1, "name": "Checkout site" }`.

### In an Application endpoint

An Application endpoint gets the same Events with staff data removed:

| Key | Admin endpoint | Application endpoint |
|---|---|---|
| `actor` of a staff change | `{ "kind": "user", ... }` | `{ "kind": "support" }` |
| `assignee` in `before` and `after` | The assignee, or `null` | Always `null`. `assigned` is `true` or `false`. |
| `team` in `before` and `after` | The Team | Left out |
| `comment.author`, staff | `{ "kind": "user", "id", "name" }` | `{ "kind": "support" }` |
| `comment.author`, the Application | `{ "kind": "application", "id", "name" }` | `{ "kind": "contact", "contact": { "id", "external_id", "name", "email" }, "application": { "id", "name" } }` |

### The test event

```json
{ "event_id": "0d0f6b9e-...", "type": "webhook.test", "created_at": "2026-10-18T10:00:00.000Z", "endpoint": { "id": "...", "name": "Slack" } }
```

## Verify the signature

Each request has three headers. Check them before you use the body.

| Header | Value |
|---|---|
| `webhook-id` | The `event_id`. It is the same for each retry of one Event. |
| `webhook-timestamp` | The time of this attempt, in Unix seconds |
| `webhook-signature` | `v1,` and the base64 HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{body}`, keyed with the secret |

The secret is `whsec_` and 32 bytes in base64. The HMAC key is those decoded bytes, not the text.

```js tab=standardwebhooks
import { Webhook } from 'standardwebhooks'

const wh = new Webhook(process.env.TIKKI_WEBHOOK_SECRET)

// rawBody: the request body as a string, exactly as received.
// Throws if the signature is wrong or the timestamp is more than 5 minutes off.
const event = wh.verify(rawBody, headers)
```

```js tab="Node.js crypto"
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verify(headers, rawBody, secret) {
  const id = headers['webhook-id']
  const timestamp = headers['webhook-timestamp']
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false

  const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  const want = Buffer.from(createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64'))
  // The header can hold more than one signature, separated by spaces.
  return headers['webhook-signature'].split(' ').some((part) => {
    const got = Buffer.from(part.replace(/^v1,/, ''))
    return part.startsWith('v1,') && got.length === want.length && timingSafeEqual(got, want)
  })
}
```

Libraries for other languages (Python, Go, Ruby, PHP, Java, Rust, C#) are on [standardwebhooks.com](https://www.standardwebhooks.com/).

> [!WARNING]
> Use the raw body. If your framework parses the JSON first and you serialize it again, the bytes change and the signature fails.

## Delivery and retries

- Tikki writes the Event in the same database step as the change, so no change is lost without its Event.
- A Cron Trigger sends due Events every minute. Expect an Event up to about one minute after the change.
- Delivery is **at least once**. Use `webhook-id` to drop an Event you already handled.
- Events can arrive out of order after a retry. Use `after.updated_at`, not the arrival time.
- Answer with any `2xx` within **10 seconds**. A redirect, a timeout, or any other status is a failure.
- Do the slow work after you answer. Put the Event in your own queue, then answer `204`.

After a failure, Tikki tries again after **1 min, 5 min, 15 min, 1 h, 3 h**, then every **6 h**. It stops **24 hours** after the Event.

After **3 days** of failures with no success, Tikki turns the endpoint off and tells the Admins in the Inbox. When an Admin turns it on again, it gets only new Events.

An endpoint gets the Events of changes made while it is on. An endpoint that you add later does not get older Events. Tikki keeps Events and their delivery log for 30 days.

## Rotate the secret

On the endpoint, click **Rotate secret**. Tikki shows the new secret once. **The old secret stops at once**, so put the new one on your receiver right after you rotate. A delivery that fails in between is retried with the new signature.

## Test your endpoint

- **Send test event** sends `webhook.test` at once.
- The delivery log on each endpoint shows every attempt: the status your receiver answered, the error, and the next retry. **Retry now** sends a pending delivery at once.
- The endpoint URL must use `https`. Tikki refuses private, loopback and link-local addresses. On a development instance, `http://localhost` works.

## Errors and edge cases

| Situation | What happens | What to do |
|---|---|---|
| Your receiver answers `500` or times out | Retry on the schedule above | Fix the receiver. Click **Retry now** to test. |
| Your receiver answers `301` or `302` | Failure. Tikki does not follow redirects. | Use the final URL. |
| The signature does not match | — | Check that you use the raw body and the current secret. Did someone rotate it? |
| The same `webhook-id` arrives twice | A retry after a lost answer | Handle it once. |
| The endpoint shows "Off" | 3 days of failures, or an Admin turned it off | Fix the receiver, then turn it on again. |
| You see no Events for a ticket | Restricted ticket, or Internal Comment, or an Application endpoint for another Application's ticket | See [Two kinds of endpoint](#two-kinds-of-endpoint). |
