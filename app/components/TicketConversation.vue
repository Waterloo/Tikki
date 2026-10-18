<script setup lang="ts">
import type { ActivityItem, CommentView, TicketDetail } from '~/types/tickets'

const props = defineProps<{
  ticket: TicketDetail
  /** Changes when the page saved a property, so the timeline reloads. */
  version: number
}>()
const emit = defineEmits<{ reverted: [ticket: TicketDetail] }>()

const toast = useToast()
const route = useRoute()
const router = useRouter()
const items = ref<ActivityItem[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const reverting = ref<string | null>(null)
const sending = ref(false)
const draft = ref('')
const mode = ref<'internal' | 'public'>('internal')

// Issue 34 adds one entry per Ticket App with the `tab` position. Each needs a `slot` name equal to its `value`.
const tabs = [
  { label: 'Conversation', value: 'conversation', slot: 'conversation' },
  { label: 'Activity', value: 'activity', slot: 'activity' }
]
const tab = computed({
  get: () => {
    const q = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab
    return tabs.some(t => t.value === q) ? String(q) : tabs[0]!.value
  },
  set: (value: string) => {
    const { tab: _drop, ...rest } = route.query
    router.replace({ query: value === tabs[0]!.value ? rest : { ...rest, tab: value } })
  }
})

type EventItem = Extract<ActivityItem, { type: 'event' }>
type CommentItem = Extract<ActivityItem, { type: 'comment' }>
const comments = computed(() => items.value.filter((i): i is CommentItem => i.type === 'comment'))
const events = computed(() => items.value.filter((i): i is EventItem => i.type === 'event'))
const latest = computed(() => events.value.at(-1))

const canInternal = computed(() => props.ticket.allowed_actions.includes('comment_internal'))
const canComment = computed(() => props.ticket.allowed_actions.includes('comment'))
const isInternal = computed(() => canInternal.value && mode.value === 'internal')
const requesterName = computed(() => displayName(props.ticket.requester))
const base = computed(() => `/api/v1/tickets/${props.ticket.ref}`)

const hint = computed(() => isInternal.value
  ? `Only your team sees internal notes. They never go to ${requesterName.value}.`
  : canInternal.value
    ? `${requesterName.value} sees this reply on the ticket.`
    : 'Your team sees this reply.')
const placeholder = computed(() => isInternal.value ? 'Write a note for your team' : canInternal.value ? `Write a reply to ${requesterName.value}` : 'Write a reply')
const submitLabel = computed(() => isInternal.value ? 'Add internal note' : canInternal.value ? 'Send public reply' : 'Send reply')

async function load(quiet = false) {
  if (!quiet) state.value = 'loading'
  try {
    items.value = (await $fetch<{ data: ActivityItem[] }>(`${base.value}/activity`)).data
    state.value = 'ready'
  } catch (e) {
    if ((e as { status?: number }).status === 401) return navigateTo('/sign-in')
    // A failed refresh keeps the list that is on screen.
    if (!quiet || !items.value.length) state.value = 'error'
  }
}

function failed(title: string, e: unknown) {
  const err = e as { status?: number, data?: { error?: { message?: string } } }
  if (err.status === 401) return navigateTo('/sign-in')
  toast.add({ title, description: err.data?.error?.message ?? 'Check your connection, then try again.', color: 'error' })
}

async function send() {
  const body = draft.value.trim()
  if (!body || sending.value) return
  sending.value = true
  try {
    await $fetch<CommentView>(`${base.value}/comments`, { method: 'POST', body: { body, visibility: isInternal.value ? 'internal' : 'public' } })
    draft.value = ''
    await load(true)
  } catch (e) {
    failed('The comment was not sent.', e)
  } finally {
    sending.value = false
  }
}

async function revert(id: string) {
  if (reverting.value) return
  reverting.value = id
  try {
    emit('reverted', await $fetch<TicketDetail>(`${base.value}/activity/${id}/revert`, { method: 'POST' }))
    await load(true)
  } catch (e) {
    failed('The change was not reverted.', e)
    await load(true)
  } finally {
    reverting.value = null
  }
}

const SOURCE = { web: '', ai: ' (via Claude)', api: ' (via API)' } as const
const cap = (v: string | null) => v ? v.charAt(0).toUpperCase() + v.slice(1) : ''

/** The parts of one line: plain text and the bold new value. */
function describe(e: EventItem): { text: string, strong?: string }[] {
  const source = actorSource(e.principal)
  const who = `${displayName(actorPerson(e.principal))}${source ? ` (${source})` : ''}${SOURCE[e.channel]}`
  const prefix = e.reverts_id ? `${who} reverted a change: ` : `${who} `
  const [before, after] = e.action === 'priority_changed' ? [cap(e.before), cap(e.after)] : [e.before, e.after]
  const from = before ?? 'none'
  const label = e.action === 'status_changed' ? 'Status' : e.action === 'priority_changed' ? 'priority' : (e.field?.label ?? 'a Field')
  if (e.action === 'ticket_created') return [{ text: `${who} created this ticket` }]
  if (e.action === 'type_changed') return e.erased ? [{ text: `${who} changed the Ticket Type` }] : [{ text: `${who} changed the Ticket Type from ${from} to ` }, { text: '', strong: after ?? 'none' }]
  if (e.action === 'description_changed') return [{ text: `${who} edited the description` }]
  if (e.action === 'ticket_cancelled') return [{ text: `${who} cancelled this ticket (cancelled by requester)` }]
  // No values: the Requester reopened it after 14 days, and a new ticket took over.
  if (e.action === 'ticket_reopened') return [{ text: e.after === null ? `${who} reopened this ticket as a new ticket` : `${who} reopened this ticket` }]
  if (e.action === 'attachment_added') return [{ text: `${who} attached ` }, { text: '', strong: after ?? 'a file' }]
  if (e.action === 'ticket_deleted') return [{ text: `${who} deleted this ticket` }]
  if (e.action === 'ticket_restored') return [{ text: `${who} restored this ticket` }]
  if (e.action === 'ticket_erased') return [{ text: `${who} erased the personal data of this ticket` }]
  if (e.action === 'participant_added') return [{ text: `${who} added ` }, { text: '', strong: after ?? 'a User' }, { text: ' as a Participant' }]
  if (e.action === 'participant_removed') return [{ text: `${who} removed ` }, { text: '', strong: before ?? 'a User' }, { text: ' from the Participants' }]
  if (e.erased) return [{ text: `${prefix}changed ${label}` }]
  if (e.action === 'assignee_changed') {
    return after === null ? [{ text: `${prefix}unassigned this ticket` }] : [{ text: `${prefix}assigned this ticket to ` }, { text: '', strong: after }]
  }
  if (e.action === 'field_changed') {
    if (after === null) return [{ text: `${prefix}cleared ${label}` }]
    if (before === null) return [{ text: `${prefix}set ${label} to ` }, { text: '', strong: after }]
  }
  return [{ text: `${prefix}changed ${label} from ${from} to ` }, { text: '', strong: after ?? 'none' }]
}

watch(() => [props.ticket.ref, props.version], () => load(true))
onMounted(() => load())
</script>

<template>
  <section aria-label="Conversation and activity" class="flex flex-col gap-3.5">
    <UTabs v-model="tab" :items="tabs" variant="link" :unmount-on-hide="false" :ui="{ root: 'gap-3.5', content: 'flex flex-col gap-3.5' }">
      <template #conversation>
        <template v-if="state === 'ready'">
          <button
            v-if="latest"
            type="button"
            class="flex items-start gap-2.5 px-1 text-left text-[13px] text-(--ui-text-muted) cursor-pointer hover:text-(--ui-text) self-start"
            @click="tab = 'activity'"
          >
            <UIcon name="i-lucide-history" class="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span class="min-w-0 [overflow-wrap:anywhere]">
              <span class="sr-only">Latest change: </span>
              <template v-for="(part, i) in describe(latest)" :key="i">
                <strong v-if="part.strong !== undefined" class="font-medium text-(--ui-text)">{{ part.strong }}</strong>
                <template v-else>{{ part.text }}</template>
              </template>
              · {{ timeAgo(latest.at) }}
            </span>
          </button>
          <ol class="flex flex-col gap-3.5 list-none p-0 m-0">
            <li v-for="item in comments" :key="item.id">
              <article
                class="rounded-[14px] border px-[18px] py-4 flex flex-col gap-2"
                :class="item.comment.visibility === 'internal'
                  ? 'bg-[#fff8eb] border-[#f1ddb5] dark:bg-[#2a2218] dark:border-[#4a3a1c]'
                  : 'bg-(--ui-bg) border-(--ui-border)'"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <UserAvatar :person="actorPerson(item.comment.author)" />
                  <span class="text-sm font-medium text-(--ui-text-highlighted)">{{ displayName(actorPerson(item.comment.author)) }}</span>
                  <span v-if="actorSource(item.comment.author)" class="inline-flex items-center min-h-[22px] px-2 rounded-full text-xs font-medium bg-(--ui-bg-accented) text-(--ui-text-toned)">{{ actorSource(item.comment.author) }}</span>
                  <span
                    v-if="item.comment.visibility === 'internal'"
                    class="inline-flex items-center gap-1 min-h-[22px] px-2 rounded-full text-xs font-medium bg-[#f7e7c6] text-[#6b4300] dark:bg-[#4a3a1c] dark:text-[#f1d9a0]"
                  >
                    <UIcon name="i-lucide-lock" class="size-3" aria-hidden="true" />
                    Internal
                  </span>
                  <SourceChip v-if="item.comment.channel !== 'web'" :channel="item.comment.channel" />
                  <time :datetime="item.at" :title="formatDateTime(item.at)" class="text-[13px] text-(--ui-text-muted)">{{ timeAgo(item.at) }}</time>
                </div>
                <p class="text-sm leading-relaxed text-(--ui-text) whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {{ item.comment.body }}
                </p>
              </article>
            </li>
          </ol>
          <p v-if="!comments.length" class="m-0 text-sm text-(--ui-text-muted)">No comments yet.</p>
        </template>
        <form
          v-if="canComment && state !== 'loading'"
          class="rounded-[14px] border p-3.5 flex flex-col gap-3"
          :class="isInternal ? 'bg-[#fff8eb] border-[#f1ddb5] dark:bg-[#2a2218] dark:border-[#4a3a1c]' : 'bg-(--ui-bg) border-[#c9d7f2] dark:border-[#2c4272]'"
          @submit.prevent="send"
        >
          <div v-if="canInternal" role="group" aria-label="Reply type" class="flex gap-1 p-1 rounded-[11px] bg-(--ui-bg-accented) self-start">
            <button
              v-for="m in ([{ key: 'internal', label: 'Internal note', icon: 'i-lucide-lock' }, { key: 'public', label: 'Public reply', icon: 'i-lucide-message-circle' }] as const)"
              :key="m.key"
              type="button"
              :aria-pressed="mode === m.key"
              class="flex items-center gap-1.5 min-h-[34px] px-3 rounded-lg border text-[13px] font-medium cursor-pointer"
              :class="mode === m.key ? 'bg-(--ui-bg) border-(--ui-border-accented) text-(--ui-text-highlighted) shadow-sm' : 'border-transparent bg-transparent text-(--ui-text-toned)'"
              @click="mode = m.key"
            >
              <UIcon :name="m.icon" class="size-[13px]" aria-hidden="true" />
              {{ m.label }}
            </button>
          </div>
          <label for="reply" class="text-[13px] text-(--ui-text-toned)">{{ hint }}</label>
          <UTextarea id="reply" v-model="draft" :rows="4" :placeholder="placeholder" :maxlength="20000" class="w-full" />
          <div class="flex justify-end">
            <button
              type="submit"
              :disabled="!draft.trim() || sending"
              class="min-h-10 px-4 rounded-[10px] text-sm font-medium text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              :class="isInternal ? 'bg-[#6b4300] dark:bg-[#8a5a10]' : 'bg-[#1f5fd6]'"
            >
              {{ sending ? 'Sending…' : submitLabel }}
            </button>
          </div>
        </form>
      </template>

      <template #activity>
        <ol v-if="state === 'ready'" class="flex flex-col gap-3.5 list-none p-0 m-0">
          <li v-for="item in events" :key="item.id">
            <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-1 text-[13px] text-(--ui-text-muted)">
              <UIcon :name="item.channel === 'ai' ? 'i-lucide-sparkles' : item.action === 'ticket_created' ? 'i-lucide-ticket' : 'i-lucide-pencil'" class="size-3.5 shrink-0" aria-hidden="true" />
              <span class="min-w-0 [overflow-wrap:anywhere]" :class="item.reverted ? 'line-through decoration-(--ui-text-dimmed)' : ''">
                <template v-for="(part, i) in describe(item)" :key="i">
                  <strong v-if="part.strong !== undefined" class="font-medium text-(--ui-text)">{{ part.strong }}</strong>
                  <template v-else>{{ part.text }}</template>
                </template>
                <span class="no-underline"> · <time :datetime="item.at" :title="formatDateTime(item.at)">{{ timeAgo(item.at) }}</time></span>
              </span>
              <p v-if="item.unmoved.length" class="basis-full m-0 pl-6 [overflow-wrap:anywhere]">
                Did not move: <template v-for="(u, i) in item.unmoved" :key="u.key">{{ i ? '; ' : '' }}{{ u.label }}: <strong class="font-medium text-(--ui-text)">{{ u.value }}</strong></template>
              </p>
              <span v-if="item.reverted" class="text-xs">Reverted</span>
              <UButton
                v-if="item.revertible"
                size="xs"
                variant="outline"
                color="neutral"
                :loading="reverting === item.id"
                :disabled="reverting !== null"
                @click="revert(item.id)"
              >
                Revert
              </UButton>
            </div>
          </li>
        </ol>
      </template>
    </UTabs>

    <div v-if="state === 'loading'" class="flex flex-col gap-3" aria-busy="true" aria-label="Loading the activity">
      <USkeleton class="h-4 w-2/3" />
      <USkeleton class="h-20 w-full rounded-[14px]" />
      <USkeleton class="h-4 w-1/2" />
    </div>

    <ErrorState v-else-if="state === 'error'" title="The activity could not be loaded." description="Check your connection, then try again." @retry="load()" />
  </section>
</template>
