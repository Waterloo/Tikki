<script setup lang="ts">
// The Webhook Endpoint of one Application (issue 15). Shapes from server/utils/webhooks.ts.
interface Endpoint {
  id: string
  url: string
  events: string[]
  status: 'healthy' | 'failing' | 'off'
  failing_since: string | null
  next_attempt_at: string | null
  disabled_at: string | null
}
interface Delivery { id: number, type: string, ticket_ref: string | null, state: 'pending' | 'delivered' | 'failed', attempts: number, response_status: number | null, error: string | null, last_attempt_at: string | null, created_at: string }

const props = defineProps<{ applicationId: number, name: string }>()
const base = computed(() => `/api/v1/applications/${props.applicationId}/webhook`)
const toast = useToast()

const state = ref<'loading' | 'ready' | 'error'>('loading')
const endpoint = ref<Endpoint | null>(null)
const log = ref<Delivery[]>([])
const url = ref('')
const urlError = ref<string | null>(null)
const busy = ref<string | null>(null)
const secret = ref<string | null>(null)
const confirm = ref<'rotate' | 'remove' | null>(null)

const GREEN = 'bg-[#e7f5ec] text-[#1b6136] dark:bg-[#16301f] dark:text-[#8fd3a8]'
const RED = 'bg-[#fdecea] text-[#a3261b] dark:bg-[#3a1512] dark:text-[#f5a8a0]'
const GREY = 'bg-(--ui-bg-accented) text-(--ui-text-muted)'
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

function message(e: unknown, fallback = 'Something went wrong. Try again.') {
  const err = (e as { data?: { error?: { message?: string, details?: { reason: string }[] | null } } }).data?.error
  return err?.details?.[0]?.reason ?? err?.message ?? fallback
}

async function load() {
  state.value = 'loading'
  try {
    endpoint.value = (await $fetch<{ data: Endpoint | null }>(base.value)).data
    url.value = endpoint.value?.url ?? ''
    await loadLog()
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}

async function loadLog() {
  log.value = endpoint.value ? (await $fetch<{ data: Delivery[] }>(`${base.value}/deliveries`)).data.slice(0, 5) : []
}

async function run(key: string, work: () => Promise<void>) {
  busy.value = key
  urlError.value = null
  try {
    await work()
  } catch (e) {
    if (key === 'save') urlError.value = message(e)
    else toast.add({ title: message(e), icon: 'i-lucide-circle-alert', color: 'error' })
  } finally {
    busy.value = null
    confirm.value = null
  }
}

const add = () => run('save', async () => {
  const created = await $fetch<Endpoint & { secret: string }>(base.value, { method: 'POST', body: { url: url.value } })
  endpoint.value = created
  secret.value = created.secret
  await loadLog()
})

const save = () => run('save', async () => {
  endpoint.value = await $fetch<Endpoint>(base.value, { method: 'PATCH', body: { url: url.value } })
  toast.add({ title: 'Webhook URL saved', icon: 'i-lucide-check', color: 'success' })
})

const turnOn = () => run('on', async () => {
  endpoint.value = await $fetch<Endpoint>(base.value, { method: 'PATCH', body: { enabled: true } })
  await loadLog()
})

const retry = () => run('retry', async () => {
  endpoint.value = await $fetch<Endpoint>(`${base.value}/retry`, { method: 'POST' })
  await loadLog()
})

const test = () => run('test', async () => {
  const d = await $fetch<Delivery>(`${base.value}/test`, { method: 'POST' })
  if (d.state === 'delivered') toast.add({ title: 'Test event delivered', description: `The endpoint answered ${d.response_status}.`, icon: 'i-lucide-check', color: 'success' })
  else toast.add({ title: 'Test event failed', description: d.error ?? 'The endpoint did not accept it.', icon: 'i-lucide-circle-alert', color: 'error' })
  endpoint.value = (await $fetch<{ data: Endpoint | null }>(base.value)).data
  await loadLog()
})

const rotate = () => run('rotate', async () => {
  secret.value = (await $fetch<{ secret: string }>(`${base.value}/rotate-secret`, { method: 'POST' })).secret
})

const remove = () => run('remove', async () => {
  await $fetch(base.value, { method: 'DELETE' })
  endpoint.value = null
  log.value = []
  url.value = ''
})

const resultText = (d: Delivery) => d.response_status ? String(d.response_status) : d.attempts === 0 ? 'Wait' : 'Error'
const resultClass = (d: Delivery) => d.state === 'delivered' ? GREEN : d.attempts === 0 ? GREY : RED
const badge = computed(() => endpoint.value?.status === 'healthy' ? ['Healthy', GREEN, 'bg-[#2f9e57]'] : endpoint.value?.status === 'failing' ? ['Failing', RED, 'bg-[#c2362f]'] : ['Off', GREY, 'bg-(--ui-text-dimmed)'])

watch(() => props.applicationId, load)
onMounted(load)
</script>

<template>
  <section aria-labelledby="hook-h" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) px-5 py-[18px] flex flex-col gap-3.5 min-w-0">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2.5">
        <h2 id="hook-h" class="text-[15px] font-semibold text-(--ui-text-highlighted) [overflow-wrap:anywhere]">
          Webhook to {{ name }}
        </h2>
        <span v-if="endpoint" class="inline-flex items-center gap-1.5 text-xs px-[9px] py-0.5 rounded-full" :class="badge[1]">
          <span class="size-2 rounded-full" :class="badge[2]" aria-hidden="true" />{{ badge[0] }}
        </span>
      </div>
      <UButton v-if="endpoint?.status === 'healthy'" color="neutral" variant="outline" :loading="busy === 'test'" @click="test">
        Send test event
      </UButton>
      <UButton v-else-if="endpoint?.status === 'failing'" :loading="busy === 'retry'" @click="retry">
        Retry now
      </UButton>
      <UButton v-else-if="endpoint" :loading="busy === 'on'" @click="turnOn">
        Turn on
      </UButton>
    </div>

    <ListSkeleton v-if="state === 'loading'" :rows="2" />
    <ErrorState v-else-if="state === 'error'" title="The webhook could not be loaded." description="Check your connection, then try again." @retry="load" />

    <template v-else>
      <p v-if="!endpoint" class="text-sm text-(--ui-text-muted)">
        No webhook yet. Add a URL and {{ name }} gets updates about its own tickets, so it can inform its customer.
      </p>
      <p v-else-if="endpoint.status === 'failing'" class="px-3 py-2.5 rounded-[10px] text-[13px] leading-normal bg-[#fdf3f2] text-[#7a1f17] dark:bg-[#2a1513] dark:text-[#f5b5ad]">
        Deliveries are failing. Events wait for up to 24 hours. After 3 days of failures we turn the webhook off and tell the admins.
      </p>
      <p v-else-if="endpoint.status === 'off'" class="px-3 py-2.5 rounded-[10px] text-[13px] leading-normal bg-(--ui-bg-elevated) text-(--ui-text-toned)">
        {{ endpoint.disabled_at ? 'We turned this webhook off after 3 days of failures.' : 'This webhook is off.' }} No events go to it until you turn it on.
      </p>

      <form class="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3.5" @submit.prevent="endpoint ? save() : add()">
        <UFormField label="URL" :error="urlError ?? undefined" help="Must use https. Private and local addresses are refused.">
          <UInput v-model="url" type="url" placeholder="https://checkout.example.com/hooks/tickets" size="lg" class="w-full font-mono" />
        </UFormField>
        <div class="flex items-end gap-2">
          <UButton type="submit" size="lg" :loading="busy === 'save'" :disabled="!url.trim() || (!!endpoint && url === endpoint.url)">
            {{ endpoint ? 'Save URL' : 'Add webhook' }}
          </UButton>
        </div>
        <div v-if="endpoint" class="flex flex-col gap-1.5">
          <span class="text-[13px] text-(--ui-text-muted)">Signing secret</span>
          <div class="flex items-center gap-2 min-h-10">
            <span class="font-mono text-[13px] text-(--ui-text-toned)">whsec_••••••••</span>
            <UButton color="neutral" variant="outline" size="sm" @click="confirm = 'rotate'">
              Rotate
            </UButton>
            <UButton color="error" variant="ghost" size="sm" @click="confirm = 'remove'">
              Remove
            </UButton>
          </div>
        </div>
      </form>

      <UAlert v-if="confirm === 'rotate'" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Rotate the signing secret?" description="The old secret stops working at once. Put the new one in the receiving system right after." :actions="[{ label: 'Rotate secret', color: 'warning', variant: 'solid', size: 'xs', loading: busy === 'rotate', onClick: rotate }, { label: 'Cancel', color: 'neutral', variant: 'ghost', size: 'xs', onClick: () => (confirm = null) }]" />
      <UAlert v-else-if="confirm === 'remove'" color="error" variant="subtle" icon="i-lucide-trash-2" title="Remove this webhook?" description="Its delivery log is deleted too. Events stop at once." :actions="[{ label: 'Remove webhook', color: 'error', variant: 'solid', size: 'xs', loading: busy === 'remove', onClick: remove }, { label: 'Cancel', color: 'neutral', variant: 'ghost', size: 'xs', onClick: () => (confirm = null) }]" />

      <div class="flex flex-wrap items-center gap-1.5 text-[13px]">
        <span class="text-(--ui-text-muted) mr-1">Sends</span>
        <span v-for="e in ['ticket.created', 'ticket.updated', 'comment.created']" :key="e" class="font-mono px-2 py-0.5 rounded-md bg-(--ui-bg-accented) text-(--ui-text-highlighted)">{{ e }}</span>
        <span class="text-(--ui-text-muted) ml-1">for {{ name }}'s tickets only, with public comments only.</span>
      </div>

      <div v-if="endpoint" class="flex flex-col">
        <span class="text-[13px] text-(--ui-text-muted) pb-1.5">Recent deliveries</span>
        <p v-if="!log.length" class="py-2.5 border-t border-(--ui-border-muted) text-[13px] text-(--ui-text-muted)">
          No deliveries yet. Send a test event, or wait for a ticket to change.
        </p>
        <div v-for="d in log" :key="d.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-10 py-1.5 border-t border-(--ui-border-muted) text-[13px]">
          <span class="font-mono px-[7px] py-px rounded-md" :class="resultClass(d)" :title="d.error ?? undefined">{{ resultText(d) }}</span>
          <span class="font-mono text-(--ui-text-highlighted)">{{ d.type }}</span>
          <span class="text-(--ui-text-toned)">{{ d.ticket_ref ?? 'Test event' }}</span>
          <span class="ml-auto text-(--ui-text-muted)">{{ clock.format(new Date(d.last_attempt_at ?? d.created_at)) }}</span>
        </div>
      </div>
    </template>

    <UModal :open="!!secret" title="Signing secret" :dismissible="false" :close="false" @update:open="(v: boolean) => !v && (secret = null)">
      <template #body>
        <div v-if="secret" class="flex flex-col gap-3">
          <p class="text-sm text-(--ui-text)">
            Copy the secret for the {{ name }} webhook now. It is not shown again.
          </p>
          <CopyField :value="secret" label="signing secret" />
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
  </section>
</template>
