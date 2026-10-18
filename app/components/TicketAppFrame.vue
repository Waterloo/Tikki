<script setup lang="ts">
import type { ContextToken, TicketAppFrame } from '~/types/ticket-apps'

/** One Ticket App in a sandboxed iframe, and the messages of docs/ticket-apps.md. */
const props = defineProps<{
  app: TicketAppFrame
  ticketRef: string
  /** Changes when the ticket changed, so the app gets a new context. */
  ticketVersion: string
}>()

const LOAD_TIMEOUT_MS = 10_000
const MIN_HEIGHT = 120
const MAX_HEIGHT = 600
// A token with less time left than this is renewed before it is sent.
const RENEW_BEFORE_MS = 60_000

const colorMode = useColorMode()
const origin = computed(() => new URL(props.app.url).origin)
const frame = ref<HTMLIFrameElement>()
const state = ref<'loading' | 'ready' | 'failed'>('loading')
const problem = ref('')
const height = ref(200)
// A new key reloads the iframe.
const attempt = ref(0)

let context: ContextToken | null = null
// Local clock time to renew at. From the token's own lifetime, so a wrong clock on this computer does not matter.
let renewAt = 0
let inflight: Promise<ContextToken> | null = null
// Bumped when the ticket changes, so an answer for the old ticket is never posted.
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined

function lifetimeMs(token: string): number {
  const claims = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { iat: number, exp: number }
  return (claims.exp - claims.iat) * 1000
}

function getContext(): Promise<ContextToken> {
  if (context && Date.now() < renewAt) return Promise.resolve(context)
  if (inflight) return inflight
  const gen = generation
  const request = $fetch<ContextToken>(`/api/v1/tickets/${encodeURIComponent(props.ticketRef)}/apps/${props.app.id}/token`, { method: 'POST' })
    .then((c) => {
      if (gen === generation) {
        context = c
        renewAt = Date.now() + lifetimeMs(c.token) - RENEW_BEFORE_MS
      }
      return c
    })
    .finally(() => {
      if (inflight === request) inflight = null
    })
  inflight = request
  return request
}

async function sendContext() {
  const gen = generation
  try {
    const c = await getContext()
    if (gen !== generation) return
    const data = { ...c.data, theme: colorMode.value === 'dark' ? 'dark' : 'light' }
    frame.value?.contentWindow?.postMessage({ type: 'tikki:context', data, token: c.token, expires_at: c.expires_at }, origin.value)
  } catch (e) {
    if ((e as { status?: number }).status === 401) return navigateTo('/sign-in')
    fail('Tikki could not get the ticket context for this app. It may be turned off.')
  }
}

function fail(message: string) {
  clearTimeout(timer)
  problem.value = message
  state.value = 'failed'
}

function start() {
  clearTimeout(timer)
  state.value = 'loading'
  // The app counts as loaded when it sends its first message: a frame `load` event also fires for an error page.
  timer = setTimeout(() => fail('The app did not answer.'), LOAD_TIMEOUT_MS)
}

function retry() {
  attempt.value++
  start()
}

function onMessage(event: MessageEvent) {
  if (!frame.value || event.source !== frame.value.contentWindow || event.origin !== origin.value) return
  const msg = event.data as { type?: unknown, height?: unknown } | null
  if (typeof msg !== 'object' || msg === null) return
  if (state.value === 'loading') {
    clearTimeout(timer)
    state.value = 'ready'
  }
  if (msg.type === 'tikki:fetch-context') {
    sendContext()
  } else if (msg.type === 'tikki:resize' && props.app.position === 'sidebar' && typeof msg.height === 'number' && Number.isFinite(msg.height)) {
    height.value = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(msg.height)))
  }
}

watch(() => [props.ticketRef, props.ticketVersion], () => {
  generation++
  context = null
  inflight = null
  sendContext()
})
watch(() => colorMode.value, () => sendContext())

onMounted(() => {
  window.addEventListener('message', onMessage)
  start()
  // Starts the token request while the frame loads.
  getContext().catch(() => {})
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  clearTimeout(timer)
})
</script>

<template>
  <div class="flex flex-col gap-2 min-w-0">
    <div v-if="state === 'failed'" role="alert" class="flex flex-wrap items-center justify-between gap-3 rounded-[10px] px-3.5 py-3 text-sm bg-(--ui-bg-elevated) text-(--ui-text)">
      <span class="flex items-center gap-2 min-w-0">
        <UIcon name="i-lucide-circle-alert" class="size-4 shrink-0 text-(--ui-error)" aria-hidden="true" />
        <span class="[overflow-wrap:anywhere]">{{ problem }}</span>
      </span>
      <UButton size="xs" color="neutral" variant="outline" @click="retry">
        Retry
      </UButton>
    </div>
    <iframe
      v-else
      ref="frame"
      :key="attempt"
      :src="app.url"
      :title="app.name"
      :data-app-id="app.id"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerpolicy="no-referrer"
      class="block w-full border-0 rounded-[10px] bg-(--ui-bg)"
      :class="app.position === 'tab' ? 'h-[70vh] min-h-[420px]' : ''"
      :style="app.position === 'sidebar' ? { height: `${height}px` } : undefined"
      @load="sendContext"
    />
  </div>
</template>
