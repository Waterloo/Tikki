<script setup lang="ts">
import type { Participant, Person } from '~/types/tickets'

const props = defineProps<{
  ticketRef: string
  /** The Requester, the assignee or an Admin: they add and remove. */
  canManage: boolean
  /** Changes when the assignee changes, so the list reloads. */
  version: number
}>()
const emit = defineEmits<{ changed: [] }>()

const toast = useToast()
const { user } = useCurrentUser()
const participants = ref<Participant[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const busy = ref<string | null>(null)

const query = ref('')
const candidates = ref<Person[]>([])
const searchState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchSeq = 0

const base = computed(() => `/api/v1/tickets/${encodeURIComponent(props.ticketRef)}/participants`)

async function load() {
  state.value = 'loading'
  try {
    participants.value = (await $fetch<{ data: Participant[] }>(base.value)).data
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}

function onSearch(value: string) {
  query.value = value
  clearTimeout(searchTimer)
  if (!value.trim()) {
    searchState.value = 'idle'
    candidates.value = []
    return
  }
  searchTimer = setTimeout(search, 250)
}

async function search() {
  // A slow answer to an older query must not replace a newer one.
  const seq = ++searchSeq
  searchState.value = 'loading'
  try {
    const found = (await $fetch<{ data: Person[] }>(`${base.value}/candidates`, { query: { q: query.value } })).data
    if (seq !== searchSeq) return
    candidates.value = found
    searchState.value = 'ready'
  } catch {
    if (seq === searchSeq) searchState.value = 'error'
  }
}

function failed(e: unknown, title: string) {
  const err = e as { status?: number, data?: { error?: { message?: string, details?: { reason: string }[] | null } } }
  if (err.status === 401) return navigateTo('/sign-in')
  toast.add({ title, description: err.data?.error?.details?.[0]?.reason ?? err.data?.error?.message ?? 'Check your connection, then try again.', color: 'error' })
}

async function add(person: Person) {
  busy.value = person.id
  try {
    participants.value = (await $fetch<{ data: Participant[] }>(base.value, { method: 'POST', body: { user_id: person.id } })).data
    onSearch('')
    emit('changed')
    toast.add({ title: `${displayName(person)} added`, color: 'success', duration: 2500 })
  } catch (e) {
    failed(e, 'The Participant was not added.')
  } finally {
    busy.value = null
  }
}

async function remove(person: Participant) {
  busy.value = person.id
  try {
    participants.value = (await $fetch<{ data: Participant[] }>(`${base.value}/${encodeURIComponent(person.id)}`, { method: 'DELETE' })).data
    emit('changed')
    toast.add({ title: `${displayName(person)} removed`, color: 'success', duration: 2500 })
  } catch (e) {
    failed(e, 'The Participant was not removed.')
  } finally {
    busy.value = null
  }
}

const TAG = { requester: 'Requester', assignee: 'Assignee' } as const

watch(() => [props.ticketRef, props.version], load)
onMounted(load)
onBeforeUnmount(() => clearTimeout(searchTimer))
</script>

<template>
  <section aria-labelledby="participants-heading" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-[18px] flex flex-col gap-3">
    <div class="flex flex-col gap-1">
      <h2 id="participants-heading" class="flex items-center gap-1.5 text-sm font-semibold text-(--ui-text-highlighted)">
        <UIcon name="i-lucide-lock" class="size-3.5 shrink-0 text-(--ui-text-muted)" aria-hidden="true" />
        Participants
      </h2>
      <p class="text-[13px] leading-snug text-(--ui-text-muted)">
        Only these people and Admins can see this ticket.
      </p>
    </div>

    <div v-if="state === 'loading'" class="flex flex-col gap-2" aria-busy="true" aria-label="Loading Participants">
      <USkeleton class="h-8 w-full rounded-[10px]" />
      <USkeleton class="h-8 w-3/4 rounded-[10px]" />
    </div>
    <ErrorState v-else-if="state === 'error'" title="The Participants could not be loaded." @retry="load" />
    <ul v-else class="flex flex-col gap-2">
      <li v-for="p in participants" :key="p.id" class="flex items-center gap-2 min-h-8">
        <UserAvatar :person="p" size="sm" />
        <span class="flex-1 min-w-0 flex flex-col">
          <span class="text-sm truncate text-(--ui-text-highlighted)">{{ displayName(p) }}<span v-if="p.id === user?.id" class="text-(--ui-text-muted)"> (you)</span></span>
          <span v-if="p.by_rule" class="text-xs text-(--ui-text-muted)">{{ TAG[p.by_rule] }}</span>
        </span>
        <UButton
          v-if="canManage && p.added"
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-lucide-x"
          :aria-label="`Remove ${displayName(p)}`"
          :loading="busy === p.id"
          :disabled="busy !== null"
          @click="remove(p)"
        />
      </li>
    </ul>

    <div v-if="canManage && state === 'ready'" class="flex flex-col gap-2">
      <label for="participant-search" class="sr-only">Add a Participant</label>
      <UInput
        id="participant-search"
        :model-value="query"
        type="search"
        icon="i-lucide-user-plus"
        placeholder="Add a person by name or email"
        autocomplete="off"
        class="w-full"
        @update:model-value="onSearch(String($event ?? ''))"
      />
      <p v-if="searchState === 'loading'" class="text-[13px] text-(--ui-text-muted)" aria-live="polite">
        Searching…
      </p>
      <p v-else-if="searchState === 'error'" class="text-[13px] text-(--ui-error)" role="alert">
        The search did not work. Try again.
      </p>
      <p v-else-if="searchState === 'ready' && candidates.length === 0" class="text-[13px] text-(--ui-text-muted)" aria-live="polite">
        Nobody else matches.
      </p>
      <ul v-else-if="searchState === 'ready'" class="flex flex-col gap-1" aria-label="People to add">
        <li v-for="c in candidates" :key="c.id">
          <button
            type="button"
            class="w-full flex items-center gap-2 min-h-10 px-2 rounded-[10px] text-left hover:bg-(--ui-bg-elevated) disabled:opacity-60 cursor-pointer"
            :disabled="busy !== null"
            @click="add(c)"
          >
            <UserAvatar :person="c" size="sm" />
            <span class="flex-1 min-w-0 flex flex-col">
              <span class="text-sm truncate text-(--ui-text-highlighted)">{{ displayName(c) }}</span>
              <span v-if="displayName(c) !== c.email" class="text-xs truncate text-(--ui-text-muted)">{{ c.email }}</span>
            </span>
            <span class="sr-only">Add</span>
            <UIcon name="i-lucide-plus" class="size-4 shrink-0 text-(--ui-text-muted)" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
