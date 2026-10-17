<script setup lang="ts">
// Shapes from server/utils/webhooks.ts.
type EventType = 'ticket.created' | 'ticket.updated' | 'comment.created'
interface Endpoint {
  id: string
  name: string
  url: string
  events: EventType[]
  include_internal: boolean
  enabled: boolean
  status: 'healthy' | 'failing' | 'off'
  failing_since: string | null
  failures: number
  disabled_at: string | null
  next_attempt_at: string | null
  last_delivery_at: string | null
}
interface Delivery {
  id: number
  type: string
  ticket_ref: string | null
  changed: string[]
  state: 'pending' | 'delivered' | 'failed'
  attempts: number
  response_status: number | null
  error: string | null
  last_attempt_at: string | null
  created_at: string
}
interface Problem { status?: number, message: string, details: { key: string, reason: string }[] }

definePageMeta({ roles: ['admin'] })

const EVENTS: { value: EventType, label: string, description: string }[] = [
  { value: 'ticket.created', label: 'ticket.created', description: 'A new ticket.' },
  { value: 'ticket.updated', label: 'ticket.updated', description: 'Status, Priority, assignee or a Field changed.' },
  { value: 'comment.created', label: 'comment.created', description: 'A new comment.' },
]
const LOG_COLUMNS = 'grid-cols-[70px_150px_minmax(160px,1fr)_90px_120px_90px]'
const GREEN = 'bg-[#e7f5ec] text-[#1b6136] dark:bg-[#12291b] dark:text-[#86d19f]'
const RED = 'bg-[#fdecea] text-[#a3261b] dark:bg-[#3a1512] dark:text-[#f5a8a0]'
const GREY = 'bg-(--ui-bg-accented) text-(--ui-text-muted)'

const toast = useToast()
const endpoints = ref<Endpoint[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const busy = ref<string | null>(null)

const selectedId = ref<string | null>(null)
const selected = computed(() => endpoints.value.find(e => e.id === selectedId.value) ?? null)
const log = ref<Delivery[]>([])
const logState = ref<'loading' | 'ready' | 'error'>('loading')
const open = ref<number | null>(null)
const payloads = ref<Record<number, string>>({})

function problemOf(e: unknown): Problem {
  const data = (e as { data?: { error?: { message?: string, details?: Problem['details'] | null } } }).data?.error
  return { status: (e as { status?: number }).status, message: data?.message ?? 'Something went wrong. Try again.', details: data?.details ?? [] }
}

async function load() {
  state.value = 'loading'
  try {
    endpoints.value = (await $fetch<{ data: Endpoint[] }>('/api/v1/webhooks')).data
    if (!selected.value) selectedId.value = (endpoints.value.find(e => e.status === 'failing') ?? endpoints.value[0])?.id ?? null
    state.value = 'ready'
  } catch (e) {
    if (problemOf(e).status === 401) return navigateTo('/sign-in')
    state.value = 'error'
  }
}

async function loadLog() {
  open.value = null
  if (!selectedId.value) return
  logState.value = 'loading'
  try {
    log.value = (await $fetch<{ data: Delivery[] }>(`/api/v1/webhooks/${selectedId.value}/deliveries`)).data
    logState.value = 'ready'
  } catch {
    logState.value = 'error'
  }
}

watch(selectedId, loadLog)
onMounted(load)

function replace(endpoint: Endpoint) {
  endpoints.value = endpoints.value.map(e => e.id === endpoint.id ? endpoint : e)
}

async function act(endpoint: Endpoint, action: 'test' | 'retry' | 'on') {
  busy.value = `${endpoint.id}:${action}`
  try {
    if (action === 'test') {
      const d = await $fetch<Delivery>(`/api/v1/webhooks/${endpoint.id}/test`, { method: 'POST' })
      if (d.state === 'delivered') toast.add({ title: 'Test event delivered', description: `The endpoint answered ${d.response_status}.`, icon: 'i-lucide-check', color: 'success' })
      else toast.add({ title: 'Test event failed', description: d.error ?? 'The endpoint did not accept it.', icon: 'i-lucide-circle-alert', color: 'error' })
      await load()
    } else if (action === 'retry') {
      replace(await $fetch<Endpoint>(`/api/v1/webhooks/${endpoint.id}/retry`, { method: 'POST' }))
    } else {
      replace(await $fetch<Endpoint>(`/api/v1/webhooks/${endpoint.id}`, { method: 'PATCH', body: { enabled: true } }))
    }
    selectedId.value = endpoint.id
    await loadLog()
  } catch (e) {
    toast.add({ title: problemOf(e).message, icon: 'i-lucide-circle-alert', color: 'error' })
  } finally {
    busy.value = null
  }
}

async function togglePayload(d: Delivery) {
  if (open.value === d.id) {
    open.value = null
    return
  }
  open.value = d.id
  if (payloads.value[d.id]) return
  try {
    const { payload } = await $fetch<{ payload: string }>(`/api/v1/webhooks/${selectedId.value}/deliveries/${d.id}`)
    payloads.value[d.id] = JSON.stringify(JSON.parse(payload), null, 2)
  } catch {
    payloads.value[d.id] = 'The payload could not be loaded. It is deleted 30 days after the event.'
  }
}

// --- Add and edit --------------------------------------------------------------------------------------------------

const editing = ref<Endpoint | null>(null)
const formOpen = ref(false)
const form = reactive({ name: '', url: '', events: [] as EventType[], include_internal: false, enabled: true })
const formProblems = ref<Record<string, string>>({})
const formError = ref<string | null>(null)
const saving = ref(false)
const confirm = ref<'rotate' | 'delete' | null>(null)
const secret = ref<{ name: string, value: string } | null>(null)

function openForm(endpoint: Endpoint | null) {
  editing.value = endpoint
  Object.assign(form, endpoint
    ? { name: endpoint.name, url: endpoint.url, events: [...endpoint.events], include_internal: endpoint.include_internal, enabled: endpoint.enabled }
    : { name: '', url: '', events: EVENTS.map(e => e.value), include_internal: false, enabled: true })
  formProblems.value = {}
  formError.value = null
  confirm.value = null
  formOpen.value = true
}

function failed(e: unknown) {
  const p = problemOf(e)
  if (p.details.length) formProblems.value = Object.fromEntries(p.details.map(d => [d.key, d.reason]))
  else formError.value = p.message
}

async function save() {
  saving.value = true
  formProblems.value = {}
  formError.value = null
  try {
    const body = { name: form.name, url: form.url, events: form.events, include_internal: form.include_internal }
    if (editing.value) {
      replace(await $fetch<Endpoint>(`/api/v1/webhooks/${editing.value.id}`, { method: 'PATCH', body: { ...body, enabled: form.enabled } }))
    } else {
      const created = await $fetch<Endpoint & { secret: string }>('/api/v1/webhooks', { method: 'POST', body })
      endpoints.value.push(created)
      selectedId.value = created.id
      secret.value = { name: created.name, value: created.secret }
    }
    formOpen.value = false
  } catch (e) {
    failed(e)
  } finally {
    saving.value = false
  }
}

async function rotate() {
  if (!editing.value) return
  saving.value = true
  try {
    const rotated = await $fetch<Endpoint & { secret: string }>(`/api/v1/webhooks/${editing.value.id}/rotate-secret`, { method: 'POST' })
    formOpen.value = false
    secret.value = { name: rotated.name, value: rotated.secret }
  } catch (e) {
    failed(e)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!editing.value) return
  const id = editing.value.id
  saving.value = true
  try {
    await $fetch(`/api/v1/webhooks/${id}`, { method: 'DELETE' })
    endpoints.value = endpoints.value.filter(e => e.id !== id)
    if (selectedId.value === id) selectedId.value = endpoints.value[0]?.id ?? null
    formOpen.value = false
  } catch (e) {
    failed(e)
  } finally {
    saving.value = false
  }
}

// --- Text ----------------------------------------------------------------------------------------------------------

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

function when(iso: string): string {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? `Today ${clock.format(d)}` : formatDateTime(iso)
}

function inMinutes(iso: string): string {
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000))
  if (minutes < 1) return 'Next try in less than a minute.'
  if (minutes < 90) return `Next try in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
  return `Next try at ${when(iso)}.`
}

const eventsText = (e: Endpoint) => e.events.length === EVENTS.length ? 'All events' : e.events.join(', ')
const ticketText = (d: Delivery) => d.ticket_ref ? [d.ticket_ref, d.changed.join(', ')].filter(Boolean).join(' · ') : 'Test event'
const tryText = (d: Delivery) => d.state === 'pending' && d.attempts > 0 ? `${d.attempts} of 24 h` : String(d.attempts)
const resultText = (d: Delivery) => d.response_status ? String(d.response_status) : d.attempts === 0 ? 'Wait' : 'Error'
const resultClass = (d: Delivery) => d.state === 'delivered' ? GREEN : d.attempts === 0 ? GREY : RED
</script>

<template>
  <AppPage id="webhooks" title="Webhooks">
    <PageHeader
      title="Webhooks"
      subtitle="Send events for all tickets to your team's tools, for example Slack or n8n. An application's own webhook is on its application page."
      :breadcrumb="[{ label: 'Admin' }, { label: 'Webhooks' }]"
    >
      <template #actions>
        <UButton icon="i-lucide-plus" size="lg" @click="openForm(null)">
          Add endpoint
        </UButton>
      </template>
    </PageHeader>

    <ListSkeleton v-if="state === 'loading'" :rows="2" />
    <ErrorState v-else-if="state === 'error'" title="The endpoints could not be loaded." description="Check your connection, then try again." @retry="load" />
    <EmptyState v-else-if="endpoints.length === 0" icon="i-lucide-link" title="No endpoints yet" description="Add an endpoint to send ticket events to a tool such as Slack or n8n. Internal data stays out unless you turn it on.">
      <UButton icon="i-lucide-plus" @click="openForm(null)">
        Add endpoint
      </UButton>
    </EmptyState>

    <template v-else>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-3.5">
        <section
          v-for="e in endpoints"
          :key="e.id"
          :aria-label="e.name"
          class="flex flex-col gap-3 rounded-[14px] bg-(--ui-bg) min-w-0"
          :class="e.status === 'failing' ? 'border-2 border-[#e9b4ae] dark:border-[#5c2a25] p-[17px]' : 'border border-(--ui-border) p-[18px]'"
        >
          <div class="flex items-center justify-between gap-2.5">
            <h2 class="text-base font-semibold text-(--ui-text-highlighted) truncate">
              {{ e.name }}
            </h2>
            <span class="inline-flex items-center gap-1.5 shrink-0 text-xs px-[9px] py-0.5 rounded-full" :class="e.status === 'healthy' ? GREEN : e.status === 'failing' ? RED : GREY">
              <span class="size-2 rounded-full" :class="e.status === 'healthy' ? 'bg-[#2f9e57]' : e.status === 'failing' ? 'bg-[#c2362f]' : 'bg-(--ui-text-dimmed)'" aria-hidden="true" />
              {{ e.status === 'healthy' ? 'Healthy' : e.status === 'failing' ? 'Failing' : 'Off' }}
            </span>
          </div>
          <span class="font-mono text-[13px] text-(--ui-text-toned) truncate" :title="e.url">{{ e.url }}</span>
          <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
            <dt class="text-(--ui-text-muted)">
              Events
            </dt>
            <dd class="text-(--ui-text-highlighted) [overflow-wrap:anywhere]">
              {{ eventsText(e) }}
            </dd>
            <dt class="text-(--ui-text-muted)">
              Internal data
            </dt>
            <dd class="flex items-center gap-1.5 text-(--ui-text-highlighted)">
              <template v-if="e.include_internal">
                <UIcon name="i-lucide-lock" class="size-3" aria-hidden="true" />Included
              </template>
              <template v-else>
                Not included
              </template>
            </dd>
            <template v-if="e.status === 'failing' && e.failing_since">
              <dt class="text-(--ui-text-muted)">
                Failing since
              </dt>
              <dd class="text-(--ui-text-highlighted)">
                {{ when(e.failing_since) }} · {{ e.failures }} {{ e.failures === 1 ? 'try' : 'tries' }}
              </dd>
            </template>
            <template v-else-if="e.disabled_at">
              <dt class="text-(--ui-text-muted)">
                Turned off
              </dt>
              <dd class="text-(--ui-text-highlighted)">
                {{ when(e.disabled_at) }}
              </dd>
            </template>
            <template v-else>
              <dt class="text-(--ui-text-muted)">
                Last delivery
              </dt>
              <dd class="text-(--ui-text-highlighted)">
                {{ e.last_delivery_at ? timeAgo(e.last_delivery_at) : 'None yet' }}
              </dd>
            </template>
          </dl>
          <p v-if="e.status === 'failing'" class="px-3 py-2.5 rounded-[10px] text-[13px] leading-normal bg-[#fdf3f2] text-[#7a1f17] dark:bg-[#2a1513] dark:text-[#f5b5ad]">
            {{ e.next_attempt_at ? inMinutes(e.next_attempt_at) : 'No event is waiting.' }} Events wait for up to 24 hours. After 3 days of failures we turn the endpoint off and tell the admins.
          </p>
          <p v-else-if="e.status === 'off'" class="px-3 py-2.5 rounded-[10px] text-[13px] leading-normal bg-(--ui-bg-elevated) text-(--ui-text-toned)">
            {{ e.disabled_at ? 'We turned this endpoint off after 3 days of failures.' : 'This endpoint is off.' }} No events go to it until you turn it on.
          </p>
          <div class="flex flex-wrap gap-2 mt-auto">
            <UButton color="neutral" variant="outline" size="sm" class="min-h-[34px]" @click="openForm(e)">
              Edit
            </UButton>
            <UButton v-if="e.status === 'healthy'" color="neutral" variant="outline" size="sm" class="min-h-[34px]" :loading="busy === `${e.id}:test`" @click="act(e, 'test')">
              Send test event
            </UButton>
            <UButton v-else-if="e.status === 'failing'" size="sm" class="min-h-[34px]" :loading="busy === `${e.id}:retry`" @click="act(e, 'retry')">
              Retry now
            </UButton>
            <UButton v-else size="sm" class="min-h-[34px]" :loading="busy === `${e.id}:on`" @click="act(e, 'on')">
              Turn on
            </UButton>
            <UButton v-if="endpoints.length > 1 && selectedId !== e.id" color="neutral" variant="ghost" size="sm" class="min-h-[34px] ml-auto" @click="selectedId = e.id">
              Deliveries
            </UButton>
          </div>
        </section>
      </div>

      <section v-if="selected" aria-labelledby="log-h" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-2 min-w-0">
        <div class="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
          <h2 id="log-h" class="text-[15px] font-semibold text-(--ui-text-highlighted) [overflow-wrap:anywhere]">
            Deliveries · {{ selected.name }}
          </h2>
          <span class="text-[13px] text-(--ui-text-muted)">Kept for 30 days</span>
        </div>
        <ListSkeleton v-if="logState === 'loading'" :rows="3" class="border-0" />
        <div v-else-if="logState === 'error'" class="px-3.5 pb-3.5">
          <ErrorState title="The deliveries could not be loaded." description="Check your connection, then try again." @retry="loadLog" />
        </div>
        <p v-else-if="log.length === 0" class="px-3.5 pb-4 text-sm text-(--ui-text-muted)">
          No deliveries yet. Events show here when a ticket changes, or send a test event.
        </p>
        <div v-else class="overflow-x-auto">
          <div class="min-w-[760px]" role="table" aria-labelledby="log-h">
            <div role="row" class="grid items-center gap-3.5 px-3.5 min-h-9 text-[13px] text-(--ui-text-muted)" :class="LOG_COLUMNS">
              <span role="columnheader">Result</span><span role="columnheader">Event</span><span role="columnheader">Ticket</span><span role="columnheader">Try</span><span role="columnheader">Time</span><span role="columnheader"><span class="sr-only">Payload</span></span>
            </div>
            <template v-for="d in log" :key="d.id">
              <div role="row" class="grid items-center gap-3.5 px-3.5 min-h-[46px] border-t border-(--ui-border-muted) text-[13px] text-(--ui-text-highlighted)" :class="[LOG_COLUMNS, open === d.id ? 'bg-(--ui-bg-elevated)' : '']">
                <span role="cell"><span class="font-mono px-[7px] py-px rounded-md" :class="resultClass(d)" :title="d.error ?? undefined">{{ resultText(d) }}</span></span>
                <span role="cell" class="font-mono truncate">{{ d.type }}</span>
                <span role="cell" class="truncate">{{ ticketText(d) }}</span>
                <span role="cell">{{ tryText(d) }}</span>
                <span role="cell" class="text-(--ui-text-muted)">{{ clock.format(new Date(d.last_attempt_at ?? d.created_at)) }}</span>
                <span role="cell" class="flex justify-end">
                  <UButton color="neutral" variant="outline" size="xs" class="min-h-[30px]" :aria-expanded="open === d.id" @click="togglePayload(d)">
                    {{ open === d.id ? 'Hide' : 'Show' }}
                  </UButton>
                </span>
              </div>
              <div v-if="open === d.id" class="px-3.5 pt-1 pb-3.5 bg-(--ui-bg-elevated)">
                <p v-if="d.error" class="mb-2 text-[13px] text-(--ui-error)">
                  {{ d.error }}
                </p>
                <pre class="m-0 px-4 py-3.5 rounded-[10px] bg-[#17181c] text-[#e8eaed] dark:bg-[#0f1013] dark:border dark:border-(--ui-border) font-mono text-xs leading-[1.6] overflow-x-auto">{{ payloads[d.id] ?? 'Loading…' }}</pre>
              </div>
            </template>
          </div>
        </div>
      </section>
    </template>

    <UModal v-model:open="formOpen" :title="editing ? 'Edit endpoint' : 'Add endpoint'" :description="editing ? undefined : 'Events are signed with HMAC-SHA256. You get the signing secret after you add the endpoint.'">
      <template #body>
        <form id="endpoint-form" class="flex flex-col gap-4" @submit.prevent="save">
          <UFormField label="Name" :error="formProblems.name" required>
            <UInput v-model="form.name" maxlength="80" placeholder="Slack #support-desk" class="w-full" />
          </UFormField>
          <UFormField label="URL" :error="formProblems.url" help="Must use https. Private and local addresses are refused." required>
            <UInput v-model="form.url" type="url" placeholder="https://hooks.example.com/tickets" class="w-full font-mono" />
          </UFormField>
          <UFormField label="Events" :error="formProblems.events">
            <UCheckboxGroup v-model="form.events" :items="EVENTS" :ui="{ label: 'font-mono text-[13px]' }" />
          </UFormField>
          <USwitch v-model="form.include_internal" label="Include internal data" description="Internal Comments go to this endpoint too. Leave it off for tools that people outside the team can read." />
          <USwitch v-if="editing" v-model="form.enabled" label="On" description="When it is off, no events go to it." />
          <UAlert v-if="formError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="formError" />

          <div v-if="editing" class="flex flex-col gap-3 border-t border-(--ui-border-muted) pt-4">
            <UAlert v-if="confirm === 'rotate'" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Rotate the signing secret?" description="The old secret stops working at once. Put the new one in the receiving tool right after." :actions="[{ label: 'Rotate secret', color: 'warning', variant: 'solid', size: 'xs', loading: saving, onClick: rotate }, { label: 'Cancel', color: 'neutral', variant: 'ghost', size: 'xs', onClick: () => (confirm = null) }]" />
            <UAlert v-else-if="confirm === 'delete'" color="error" variant="subtle" icon="i-lucide-trash-2" title="Delete this endpoint?" description="Its delivery log is deleted too. Events stop at once." :actions="[{ label: 'Delete endpoint', color: 'error', variant: 'solid', size: 'xs', loading: saving, onClick: remove }, { label: 'Cancel', color: 'neutral', variant: 'ghost', size: 'xs', onClick: () => (confirm = null) }]" />
            <div v-else class="flex flex-wrap gap-2">
              <UButton color="neutral" variant="outline" icon="i-lucide-key-round" @click="confirm = 'rotate'">
                Rotate secret
              </UButton>
              <UButton color="error" variant="ghost" icon="i-lucide-trash-2" @click="confirm = 'delete'">
                Delete
              </UButton>
            </div>
          </div>
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton color="neutral" variant="ghost" @click="formOpen = false">
            Cancel
          </UButton>
          <UButton type="submit" form="endpoint-form" :loading="saving" :disabled="!form.name.trim() || !form.url.trim()">
            {{ editing ? 'Save' : 'Add endpoint' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal :open="!!secret" title="Signing secret" :dismissible="false" :close="false" @update:open="v => !v && (secret = null)">
      <template #body>
        <div v-if="secret" class="flex flex-col gap-3">
          <p class="text-sm text-(--ui-text)">
            Copy the secret for <strong class="font-medium text-(--ui-text-highlighted)">{{ secret.name }}</strong> now. It is not shown again.
          </p>
          <CopyField :value="secret.value" label="signing secret" />
          <p class="text-[13px] text-(--ui-text-muted)">
            Each request has the headers <code class="font-mono">webhook-id</code>, <code class="font-mono">webhook-timestamp</code> and <code class="font-mono">webhook-signature</code> (Standard Webhooks). Check the signature with this secret, and drop a repeated <code class="font-mono">webhook-id</code>.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end w-full">
          <UButton @click="secret = null">
            I copied it
          </UButton>
        </div>
      </template>
    </UModal>
  </AppPage>
</template>
