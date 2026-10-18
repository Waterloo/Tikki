import type { TicketDetail } from '~/types/tickets'
import type { PageTool, TicketPage, ToolDeps } from '~/utils/webmcp'

// WebMCP (docs/research/webmcp.md). The only file that calls `registerTool`.

interface ModelContext {
  registerTool: (tool: PageTool, options: { signal: AbortSignal }) => void
}

/** Null when the browser has no WebMCP. Then the page registers nothing. */
function modelContext(): ModelContext | null {
  const mc = (document as { modelContext?: Partial<ModelContext> }).modelContext
  return typeof mc?.registerTool === 'function' ? mc as ModelContext : null
}

/** The ticket page that shows a ticket and has its tools registered. */
const current = shallowRef<{ ref: string, hasDraft: () => boolean } | null>(null)

function shown(ref: string, timeoutMs: number): Promise<boolean> {
  if (current.value?.ref === ref) return Promise.resolve(true)
  return new Promise((resolve) => {
    const stop = watch(current, (c) => {
      if (c?.ref !== ref) return
      clearTimeout(timer)
      stop()
      resolve(true)
    })
    const timer = setTimeout(() => {
      stop()
      resolve(false)
    }, timeoutMs)
  })
}

// Plain types: the typed routes of `$fetch` are too deep for a URL built at run time.
const untypedFetch = (url: string, options: object) => ($fetch as (url: string, options: object) => Promise<unknown>)(url, options)

function deps(router: ReturnType<typeof useRouter>): ToolDeps {
  return {
    // The header marks the change as `ai` in Activity and puts it under the MCP rate limits (server/utils/rest.ts).
    api: <T>(url: string, init?: object) => (untypedFetch(url, { ...init, headers: { 'X-Tikki-Channel': 'ai' } }) as Promise<T>),
    current: () => current.value,
    navigate: path => router.push(path),
    shown,
  }
}

function register(tools: PageTool[], signal: AbortSignal) {
  const mc = modelContext()
  for (const tool of tools) mc?.registerTool(tool, { signal })
}

/** The tools of every signed-in page. Call once, in the default layout. Sign-out aborts them. */
export function useWebMcpTools() {
  if (!modelContext()) return
  const { user } = useCurrentUser()
  const router = useRouter()
  watch(() => user.value?.id, (id, _old, onCleanup) => {
    if (!id) return
    const controller = new AbortController()
    onCleanup(() => controller.abort())
    register(webMcpPageTools(deps(router)), controller.signal)
  }, { immediate: true })
}

/**
 * The current-ticket tools while the ticket page shows `ticket` (null while it loads). Leaving the page, another
 * ticket, or sign-out aborts them.
 */
export function useCurrentTicketTools(shownTicket: () => TicketDetail | null, page: TicketPage & { hasDraft: () => boolean }) {
  if (!modelContext()) return
  const { user } = useCurrentUser()
  const router = useRouter()
  // Only what changes the tool set: a Status change does not register the tools again.
  const key = () => {
    const t = shownTicket()
    return t && user.value ? `${user.value.id} ${t.ref} ${t.allowed_actions.includes('change_status')}` : null
  }
  watch(key, (k, _old, onCleanup) => {
    const ticket = shownTicket()
    if (!k || !ticket) return
    const shownRef = ticket.ref
    const controller = new AbortController()
    onCleanup(() => {
      controller.abort()
      if (current.value?.ref === shownRef) current.value = null
    })
    register(webMcpTicketTools(ticket, deps(router), page), controller.signal)
    current.value = { ref: shownRef, hasDraft: page.hasDraft }
  }, { immediate: true })
}
