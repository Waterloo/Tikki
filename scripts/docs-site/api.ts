import { codeBlock, codeTabs, escapeHtml, inline, type Heading, type Highlighter } from './markdown'

/** The origin in every example. The page shows the address of the instance that serves it (docs.js). */
export const EXAMPLE_ORIGIN = 'https://tikki.example.com'

interface Schema {
  $ref?: string
  type?: string | string[]
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  enum?: unknown[]
  anyOf?: Schema[]
  oneOf?: Schema[]
  const?: unknown
  format?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  default?: unknown
  description?: string
  additionalProperties?: Schema | boolean
}
interface Parameter { name: string, in: string, required?: boolean, schema: Schema, description?: string, example?: unknown }
interface Media { schema: Schema, example?: unknown }
interface Response { description: string, content?: Record<string, Media> }
interface Operation {
  operationId: string
  summary: string
  description?: string
  tags?: string[]
  parameters?: Parameter[]
  requestBody?: { required?: boolean, content: Record<string, Media> }
  responses: Record<string, Response>
}
export interface OpenApiDocument {
  info: { title: string, description: string }
  tags?: { name: string, description?: string }[]
  components: { schemas: Record<string, Schema>, securitySchemes: Record<string, { description?: string }> }
  paths: Record<string, Record<string, Operation>>
}

const METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const
const METHOD_LABEL: Record<string, string> = { get: 'GET', post: 'POST', patch: 'PATCH', put: 'PUT', delete: 'DEL' }

export const operationAnchor = (op: Operation) => op.operationId.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)

export interface ApiOperation { method: string, path: string, op: Operation }

/** The operations in tag order, then path order. An operation without a tag fails the build: it would have no place in the menu. */
export function operations(doc: OpenApiDocument): { tag: string, ops: ApiOperation[] }[] {
  const all: ApiOperation[] = []
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = item[method]
      if (!op) continue
      if (!op.tags?.[0]) throw new Error(`Docs: ${method.toUpperCase()} ${path} has no tag in the OpenAPI document.`)
      all.push({ method, path, op })
    }
  }
  const tags = doc.tags?.map(t => t.name) ?? []
  for (const o of all) if (!tags.includes(o.op.tags![0]!)) throw new Error(`Docs: tag "${o.op.tags![0]}" is not in the document's tags.`)
  return tags.map(tag => ({ tag, ops: all.filter(o => o.op.tags![0] === tag) })).filter(g => g.ops.length)
}

export const methodBadge = (method: string) => `<span class="method method-${method}">${METHOD_LABEL[method]}</span>`

function resolve(doc: OpenApiDocument, s: Schema): Schema {
  if (!s.$ref) return s
  const name = s.$ref.replace('#/components/schemas/', '')
  const found = doc.components.schemas[name]
  if (!found) throw new Error(`Docs: unknown schema ${s.$ref}.`)
  return resolve(doc, found)
}

/** A short type line: `string · ≤ 200`, `low | normal | high`, `object`, `TicketSummary[]`. */
function typeOf(doc: OpenApiDocument, raw: Schema): string {
  const name = raw.$ref?.replace('#/components/schemas/', '')
  const s = resolve(doc, raw)
  if (s.enum) return s.enum.map(v => String(v)).join(' | ')
  if (s.const !== undefined) return JSON.stringify(s.const)
  const variants = s.anyOf ?? s.oneOf
  if (variants) return variants.map(v => typeOf(doc, v)).join(' | ')
  const type = Array.isArray(s.type) ? s.type.join(' | ') : s.type ?? 'any'
  if (type === 'array' && s.items) {
    const item = s.items.$ref ? s.items.$ref.replace('#/components/schemas/', '') : typeOf(doc, s.items)
    return `${item}[]`
  }
  const limits = [
    s.format,
    s.minLength !== undefined && s.maxLength !== undefined ? `${s.minLength}–${s.maxLength}` : s.maxLength !== undefined ? `≤ ${s.maxLength}` : '',
    s.minimum !== undefined ? `≥ ${s.minimum}` : '',
  ].filter(Boolean)
  return [name && type === 'object' ? name : type, ...limits].join(' · ')
}

const nullable = (s: Schema) => (s.anyOf ?? s.oneOf)?.some(v => v.type === 'null') ?? false

/** The properties of an object schema as a list, nested objects inside. `depth` stops runaway nesting. */
function properties(doc: OpenApiDocument, raw: Schema, depth = 0): string {
  const s = resolve(doc, raw)
  if (!s.properties) return ''
  const required = new Set(s.required ?? [])
  const rows = Object.entries(s.properties).map(([key, p]) => {
    const resolved = resolve(doc, p)
    const object = (resolved.anyOf ?? resolved.oneOf)?.find(v => v.properties) ?? resolved
    const nested = depth < 2 && object.properties ? `<div class="props props-nested">${properties(doc, object, depth + 1)}</div>` : ''
    const notes = [
      p.description ?? resolved.description,
      resolved.default !== undefined ? `Default \`${JSON.stringify(resolved.default)}\`.` : '',
    ].filter(Boolean).join(' ')
    return `<div class="prop"><div><code class="prop-name">${escapeHtml(key)}</code><span class="prop-type">${escapeHtml(typeOf(doc, p))}</span>`
      + `${required.has(key) && !nullable(resolved) ? '<span class="prop-req">required</span>' : ''}</div>`
      + `${notes ? `<p>${inline(notes)}</p>` : ''}${nested}</div>`
  })
  return rows.join('')
}

function exampleUrl(path: string, params: Parameter[]): string {
  return EXAMPLE_ORIGIN + path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const p = params.find(x => x.in === 'path' && x.name === name)
    if (p?.example === undefined) throw new Error(`Docs: path parameter {${name}} of ${path} has no example.`)
    return String(p.example)
  })
}

/** curl and fetch calls built from the examples in the document. */
export function requestSamples(hl: Highlighter, { method, path, op }: ApiOperation): string {
  const params = op.parameters ?? []
  const url = exampleUrl(path, params)
  const headers = params.filter(p => p.in === 'header' && p.example !== undefined).map(p => [p.name, String(p.example)] as const)
  const body = op.requestBody?.content['application/json']?.example
  if (op.requestBody && body === undefined) throw new Error(`Docs: ${op.operationId} has a body but no example.`)
  const M = method.toUpperCase()

  const curl = [
    `curl${M === 'GET' ? '' : ` -X ${M}`} ${url}`,
    `  -H "Authorization: Bearer $TIKKI_KEY"`,
    ...(body !== undefined ? [`  -H "Content-Type: application/json"`] : []),
    ...headers.map(([k, v]) => `  -H "${k}: ${v}"`),
    ...(body !== undefined ? [`  -d '${JSON.stringify(body, null, 2)}'`] : []),
  ].join(' \\\n')

  const jsHeaders = [
    `    authorization: \`Bearer \${process.env.TIKKI_KEY}\`,`,
    ...(body !== undefined ? [`    'content-type': 'application/json',`] : []),
    ...headers.map(([k, v]) => `    '${k.toLowerCase()}': '${v}',`),
  ]
  const jsBody = body !== undefined ? `  body: JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, '\n  ')}),\n` : ''
  const success = Object.keys(op.responses).find(s => s.startsWith('2'))
  const read = success === '204' ? '' : '\nconst data = await res.json()'
  const js = `const res = await fetch('${url}', {\n${M === 'GET' ? '' : `  method: '${M}',\n`}  headers: {\n${jsHeaders.join('\n')}\n  },\n${jsBody}})${read}`

  return codeTabs(hl, [{ label: 'curl', code: curl, info: 'bash' }, { label: 'JavaScript', code: js, info: 'js' }])
}

function responseSamples(hl: Highlighter, op: Operation): string {
  const withExample = Object.entries(op.responses).filter(([, r]) => r.content?.['application/json']?.example !== undefined)
  if (!withExample.length) return ''
  return `<div class="response-samples"><p class="label">Response</p>${codeTabs(hl, withExample.map(([status, r]) => ({
    label: status, code: JSON.stringify(r.content!['application/json']!.example, null, 2), info: 'json',
  })))}</div>`
}

function statusClass(status: string) {
  return status.startsWith('2') ? 'ok' : 'err'
}

function operationHtml(hl: Highlighter, doc: OpenApiDocument, o: ApiOperation): string {
  const { method, path, op } = o
  const params = op.parameters ?? []
  const odd = params.find(p => !['path', 'query', 'header'].includes(p.in))
  if (odd) throw new Error(`Docs: ${op.operationId} has a parameter in "${odd.in}", which the reference cannot show.`)
  const groups = (['path', 'query', 'header'] as const).map((where) => {
    const list = params.filter(p => p.in === where)
    if (!list.length) return ''
    const title = { path: 'Path', query: 'Query', header: 'Header' }[where]
    const rows = list.map(p => `<div class="prop"><div><code class="prop-name">${escapeHtml(p.name)}</code><span class="prop-type">${escapeHtml(typeOf(doc, p.schema))}</span>${p.required ? '<span class="prop-req">required</span>' : ''}</div>${p.description ? `<p>${inline(p.description)}</p>` : ''}</div>`).join('')
    return `<h3>${title}</h3><div class="props">${rows}</div>`
  }).join('')
  const bodySchema = op.requestBody?.content['application/json']?.schema
  const body = bodySchema ? `<h3>Body <span class="muted mono">application/json</span></h3><div class="props">${properties(doc, bodySchema)}</div>` : ''
  const responses = Object.entries(op.responses).map(([status, r]) => {
    const schema = r.content?.['application/json']?.schema
    const resolved = schema && resolve(doc, schema)
    const fields = resolved?.properties && !schema!.$ref?.endsWith('/Error')
      ? `<details><summary>Show the fields</summary><div class="props">${properties(doc, schema!)}</div></details>` : ''
    return `<div class="response"><span class="status status-${statusClass(status)}">${status}</span><div>${inline(r.description)}${fields}</div></div>`
  }).join('')
  const id = operationAnchor(op)
  return `<section class="operation" aria-labelledby="${id}">
<div class="operation-text">
<p class="endpoint">${methodBadge(method)}<code>${escapeHtml(path)}</code></p>
<h2 id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${escapeHtml(op.summary)}</h2>
${op.description ? `<p>${inline(op.description)}</p>` : ''}
${groups}${body}
<h3>Responses</h3><div class="responses">${responses}</div>
</div>
<div class="operation-samples">${requestSamples(hl, o)}${responseSamples(hl, op)}</div>
</section>`
}

export interface ApiLimits { requests: number, creates: number }

export function renderApiReference(hl: Highlighter, doc: OpenApiDocument, limits: ApiLimits): { html: string, headings: Heading[] } {
  const groups = operations(doc)
  const headings: Heading[] = [{ depth: 2, text: 'Authentication', id: 'authentication' }, { depth: 2, text: 'Errors and limits', id: 'errors-and-limits' }]
  const auth = doc.components.securitySchemes.apiKey?.description ?? ''
  const intro = `<div class="cards">
<section class="card"><h2 id="authentication">Authentication</h2><p>${inline(auth)} An Admin makes the key on the <strong>Applications</strong> page. Tikki shows it once.</p>${codeBlock(hl, 'Authorization: Bearer gt_live_...', 'http')}</section>
<section class="card"><h2 id="base-url">Base URL</h2><p>All paths are on your Tikki origin. The OpenAPI document is at <a href="/api/v1/openapi.json"><code>/api/v1/openapi.json</code></a>: load it in Postman, Insomnia or a code generator.</p>${codeBlock(hl, EXAMPLE_ORIGIN, 'text')}</section>
</div>
<div class="callout callout-note" role="note"><p>These routes use the API key of an Application. A Ticket App's backend uses its context token on a few other routes. See <a href="/docs/ticket-apps#change-the-ticket">Change the ticket</a>.</p></div>`

  const body = groups.map(g => {
    const tag = doc.tags!.find(t => t.name === g.tag)!
    headings.push(...g.ops.map(o => ({ depth: 3 as const, text: o.op.summary, id: operationAnchor(o.op) })))
    return `<div class="tag-group"><p class="tag-name">${escapeHtml(g.tag)}</p>${tag.description ? `<p class="muted">${inline(tag.description)}</p>` : ''}</div>${g.ops.map(o => operationHtml(hl, doc, o)).join('\n')}`
  }).join('\n')

  const errors = `<section class="prose-section"><h2 id="errors-and-limits"><a class="anchor" href="#errors-and-limits" aria-hidden="true" tabindex="-1">#</a>Errors and limits</h2>
<p>Every error has the same shape. Use <code>code</code> in your program. Show <code>message</code> to people. For <code>VALIDATION_FAILED</code>, <code>details</code> has one entry for each problem.</p>
${codeBlock(hl, JSON.stringify({ error: { code: 'VALIDATION_FAILED', message: 'The request has invalid values.', details: [{ key: 'order_id', label: 'Order ID', reason: 'Required.' }] } }, null, 2), 'json')}
<div class="table" data-scroll-x><table><thead><tr><th scope="col">Status</th><th scope="col">code</th><th scope="col">What to do</th></tr></thead><tbody>
<tr><td>400</td><td><code>INVALID_JSON</code></td><td>Send a valid JSON body.</td></tr>
<tr><td>400</td><td><code>INVALID_IDEMPOTENCY_KEY</code></td><td>Use 1 to 255 visible ASCII characters, for example a UUID.</td></tr>
<tr><td>401</td><td><code>UNAUTHENTICATED</code></td><td>Send a valid API key. A revoked key stops at once.</td></tr>
<tr><td>403</td><td><code>APPLICATION_DISABLED</code></td><td>An Admin must enable the Application again.</td></tr>
<tr><td>403</td><td><code>FORBIDDEN</code></td><td>Ask the Admin for the permission or the Ticket Type.</td></tr>
<tr><td>404</td><td><code>NOT_FOUND</code></td><td>The item does not exist, or it belongs to another source.</td></tr>
<tr><td>409</td><td><code>IDEMPOTENCY_KEY_REUSED</code></td><td>Use a new key for a new ticket.</td></tr>
<tr><td>422</td><td><code>VALIDATION_FAILED</code></td><td>Fix each value in <code>details</code>, then send again.</td></tr>
<tr><td>429</td><td><code>RATE_LIMITED</code></td><td>Wait the seconds in <code>Retry-After</code>, then retry.</td></tr>
</tbody></table></div>
<p>Each Application has its own limit. The default is <strong>${limits.requests} requests a minute</strong>, of them at most <strong>${limits.creates} creates</strong>. The Admin can change both on the Application page, which also shows the current values.</p>
<p>To retry a create safely, send the same <code>Idempotency-Key</code>. A repeat in 24 hours returns the first ticket and creates nothing.</p>
</section>`

  return { html: intro + body + errors, headings }
}
