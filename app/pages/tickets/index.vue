<script setup lang="ts">
import type { Status, TicketList, TicketSummary } from '~/types/tickets'

definePageMeta({ roles: ['admin', 'agent'] })

type Filter = 'all' | 'unassigned' | 'mine'

// USelect cannot hold an empty value, so "no filter" is this word.
const ALL = 'all'

const FILTERS: { value: Filter, label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'mine', label: 'Assigned to me' },
]
const QUERY: Record<Filter, string | undefined> = { all: undefined, unassigned: 'none', mine: 'me' }

const EMPTY: Record<Filter, { title: string, description: string }> = {
  all: { title: 'No tickets yet', description: 'Tickets from the web form and from Claude show here, grouped by Status.' },
  unassigned: { title: 'Every ticket has an owner', description: 'New tickets show here until an Agent assigns them.' },
  mine: { title: 'Nothing is assigned to you', description: 'Open a ticket and choose “Assign to me” to take it.' },
}

// One grid for the header and the rows, so the columns line up. Below `xl` each row becomes a card.
const COLUMNS = 'xl:grid-cols-[88px_minmax(0,2.2fr)_minmax(0,1fr)_84px_minmax(0,1.3fr)_minmax(0,1fr)_88px]'

const PRIORITY_ITEMS = [{ label: 'Any priority', value: ALL }, ...(['urgent', 'high', 'normal', 'low'] as const).map(p => ({ label: p[0]!.toUpperCase() + p.slice(1), value: p }))]
// Branch is a normal Field (4.12). The filter shows when a type has a Field with this key.
const BRANCH_KEY = 'branch'

const route = useRoute()
const one = (v: unknown) => (typeof v === 'string' ? v : undefined)
const filter = computed<Filter>(() => route.query.filter === 'unassigned' || route.query.filter === 'mine' ? route.query.filter : 'all')
const search = computed(() => one(route.query.q)?.trim() ?? '')
const typeId = computed(() => one(route.query.type) ?? ALL)
const priority = computed(() => one(route.query.priority) ?? ALL)
const branch = computed(() => one(route.query.branch) ?? ALL)
const narrowed = computed(() => search.value !== '' || typeId.value !== ALL || priority.value !== ALL || branch.value !== ALL)

const typeItems = ref<{ label: string, value: string }[]>([])
const branchItems = ref<{ label: string, value: string }[]>([])
const searchText = ref(search.value)

const statuses = ref<Status[]>([])
const list = ref<TicketList>({ data: [], counts: {}, next_cursor: null })
const loadingMore = ref(false)
const moreFailed = ref(false)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const refreshing = ref(false)
// Done work is out of the way by default (canvas: Resolved starts collapsed).
const collapsed = ref(new Set<string>())

const groups = computed(() => groupByStatus(statuses.value, list.value.data, list.value.counts))
const total = computed(() => groups.value.reduce((sum, g) => sum + g.count, 0))

let latest = 0

function params(cursor?: string) {
  return {
    assignee: QUERY[filter.value],
    q: search.value || undefined,
    type: typeId.value === ALL ? undefined : typeId.value,
    priority: priority.value === ALL ? undefined : priority.value,
    field: branch.value === ALL ? undefined : `${BRANCH_KEY}:${branch.value}`,
    cursor,
  }
}

async function load() {
  const request = ++latest
  if (state.value !== 'ready') state.value = 'loading'
  else refreshing.value = true
  try {
    const [s, l] = await Promise.all([
      statuses.value.length ? Promise.resolve({ data: statuses.value }) : $fetch<{ data: Status[] }>('/api/v1/statuses'),
      $fetch<TicketList>('/api/v1/tickets', { query: params() }),
    ])
    // A newer filter may have finished first.
    if (request !== latest) return
    if (!statuses.value.length) collapsed.value = new Set(s.data.filter(x => x.category === 'done').map(x => x.key))
    statuses.value = s.data
    list.value = l
    state.value = 'ready'
  } catch (e) {
    if (request !== latest) return
    if ((e as { status?: number }).status === 401) return navigateTo('/sign-in')
    state.value = 'error'
  } finally {
    if (request === latest) refreshing.value = false
  }
}

function toggle(key: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(key)) next.add(key)
  collapsed.value = next
}

async function loadMore() {
  const request = latest
  loadingMore.value = true
  moreFailed.value = false
  try {
    const next = await $fetch<TicketList>('/api/v1/tickets', { query: params(list.value.next_cursor ?? undefined) })
    if (request !== latest) return
    list.value = { ...next, data: [...list.value.data, ...next.data] }
  } catch {
    moreFailed.value = true
  } finally {
    loadingMore.value = false
  }
}

/** Changes the filters in the address, so a filtered list can be shared and the back button works. */
function setQuery(changes: Record<string, string | undefined>) {
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...route.query, ...changes })) {
    if (typeof v === 'string' && v !== '' && v !== ALL) next[k] = v
  }
  navigateTo({ query: next }, { replace: true })
}

const pick = (value: Filter) => setQuery({ filter: value === 'all' ? undefined : value })
const clearFilters = () => navigateTo({ query: filter.value === 'all' ? {} : { filter: filter.value } }, { replace: true })

let typing: ReturnType<typeof setTimeout> | undefined
let pushed = search.value
function onSearch(value: string) {
  searchText.value = value
  clearTimeout(typing)
  typing = setTimeout(() => {
    pushed = value.trim()
    setQuery({ q: pushed })
  }, 300)
}

// The filter menus are a help. If they cannot load, the list still works.
async function loadFilterChoices() {
  try {
    const { data } = await $fetch<{ data: { id: number, name: string }[] }>('/api/v1/ticket-types')
    typeItems.value = [{ label: 'Any type', value: ALL }, ...data.map(t => ({ label: t.name, value: String(t.id) }))]
    const details = await Promise.all(data.map(t => $fetch<{ fields: { key: string, options?: string[] }[] }>(`/api/v1/ticket-types/${t.id}`)))
    const options = new Set(details.flatMap(d => d.fields.find(f => f.key === BRANCH_KEY)?.options ?? []))
    if (options.size) branchItems.value = [{ label: 'Any branch', value: ALL }, ...[...options].sort().map(o => ({ label: o, value: o }))]
  } catch { /* the menus stay hidden */ }
}

function shownIn(groupTickets: TicketSummary[], count: number) {
  return groupTickets.length > 0 && count > groupTickets.length ? `Showing ${groupTickets.length} of ${count}.` : null
}

watch(() => route.fullPath, () => {
  // The box follows the address when something else changed it (back button, Clear filters).
  if (search.value !== pushed) searchText.value = pushed = search.value
  load()
})
onMounted(() => {
  load()
  loadFilterChoices()
})
onBeforeUnmount(() => clearTimeout(typing))
</script>

<template>
  <AppPage id="all-tickets" title="All tickets">
    <PageHeader
      title="All tickets"
      subtitle="Every ticket from the web and from Claude, grouped by Status."
      :breadcrumb="[{ label: 'Tickets' }, { label: 'All tickets' }]"
    >
      <template #actions>
        <UButton to="/tickets/new" icon="i-lucide-plus" size="lg">
          New ticket
        </UButton>
      </template>
    </PageHeader>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Filter tickets" class="inline-flex flex-wrap gap-1 p-1 rounded-xl bg-(--app-segment) self-start">
        <button
          v-for="f in FILTERS"
          :key="f.value"
          type="button"
          :aria-pressed="filter === f.value"
          class="min-h-9 px-3.5 rounded-[9px] border text-sm font-medium transition-colors"
          :class="filter === f.value
            ? 'border-(--ui-border-accented) bg-(--ui-bg) text-(--ui-text-highlighted) shadow-xs'
            : 'border-transparent text-(--ui-text-toned) hover:text-(--ui-text-highlighted)'"
          @click="pick(f.value)"
        >
          {{ f.label }}
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-2 min-w-0 w-full sm:w-auto">
        <UInput
          :model-value="searchText"
          type="search"
          icon="i-lucide-search"
          placeholder="Search title or number"
          aria-label="Search tickets"
          size="lg"
          class="w-full sm:w-60"
          @update:model-value="onSearch(String($event ?? ''))"
        />
        <USelect v-if="typeItems.length" :model-value="typeId" :items="typeItems" aria-label="Ticket Type" size="lg" class="min-w-32" @update:model-value="setQuery({ type: $event })" />
        <USelect :model-value="priority" :items="PRIORITY_ITEMS" aria-label="Priority" size="lg" class="min-w-32" @update:model-value="setQuery({ priority: $event })" />
        <USelect v-if="branchItems.length" :model-value="branch" :items="branchItems" aria-label="Branch" size="lg" class="min-w-32" @update:model-value="setQuery({ branch: $event })" />
      </div>
    </div>

    <ListSkeleton v-if="state === 'loading'" :rows="6" />

    <ErrorState v-else-if="state === 'error'" title="The tickets could not be loaded." description="Check your connection, then try again." @retry="load" />

    <EmptyState v-else-if="total === 0 && narrowed" icon="i-lucide-search-x" title="No tickets match" description="Try other words, or remove a filter.">
      <UButton size="lg" variant="outline" @click="clearFilters">
        Clear search and filters
      </UButton>
    </EmptyState>

    <EmptyState v-else-if="total === 0" icon="i-lucide-layers" :title="EMPTY[filter].title" :description="EMPTY[filter].description">
      <UButton v-if="filter === 'mine'" to="/tickets?filter=unassigned" size="lg" variant="outline">
        Show unassigned
      </UButton>
    </EmptyState>

    <div v-else class="flex flex-col gap-4 transition-opacity" :class="refreshing ? 'opacity-60' : ''" :aria-busy="refreshing">
      <section
        v-for="g in groups"
        :key="g.status.key"
        :aria-labelledby="`group-${g.status.key}`"
        class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-2"
      >
        <h2 :id="`group-${g.status.key}`">
          <button
            type="button"
            :aria-expanded="!collapsed.has(g.status.key)"
            :aria-controls="`rows-${g.status.key}`"
            class="w-full flex items-center gap-2.5 min-h-11 px-3 rounded-[10px] text-[15px] font-semibold text-left"
            :class="STATUS_CLASS[g.status.category]"
            @click="toggle(g.status.key)"
          >
            <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 transition-transform" :class="collapsed.has(g.status.key) ? '-rotate-90' : ''" aria-hidden="true" />
            <StatusIcon :category="g.status.category" class="size-4" />
            <span class="truncate">{{ g.status.name }}</span>
            <span class="ml-0.5 px-2 rounded-full text-xs font-medium bg-(--ui-bg) text-(--ui-text)">
              {{ g.count }}<span class="sr-only"> tickets</span>
            </span>
          </button>
        </h2>

        <div v-if="!collapsed.has(g.status.key)" :id="`rows-${g.status.key}`">
          <p v-if="g.tickets.length === 0 && g.count > 0" class="px-4 pt-4 pb-2 text-sm text-(--ui-text-muted)">
            {{ g.count }} more below. Use Load more.
          </p>
          <p v-else-if="g.tickets.length === 0" class="px-4 pt-4 pb-2 text-sm text-(--ui-text-muted)">
            No tickets with this Status{{ filter === 'all' && !narrowed ? '' : ' match this filter' }}.
          </p>
          <template v-else>
            <div class="hidden xl:grid items-center gap-4 px-4 mt-1.5 min-h-10 text-[13px] text-(--ui-text-muted)" :class="COLUMNS" aria-hidden="true">
              <span>Ticket</span><span>Title</span><span>Type</span><span>Priority</span><span>Requester</span><span>Assignee</span><span>Updated</span>
            </div>
            <ul class="flex flex-col">
              <li v-for="t in g.tickets" :key="t.number" class="border-t border-(--ui-border-muted) first:border-t-0 xl:first:border-t">
                <NuxtLink
                  :to="`/tickets/${t.ref}`"
                  class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 xl:gap-4 px-4 py-3 xl:py-0 xl:min-h-[52px] rounded-lg hover:bg-(--app-row-hover) focus-visible:outline-2 focus-visible:outline-(--ui-primary)"
                  :class="COLUMNS"
                >
                  <span class="row-start-1 col-start-1 xl:row-start-auto xl:col-start-auto">
                    <TicketRef :value="t.ref" />
                  </span>
                  <span class="row-start-2 col-span-3 xl:row-start-auto xl:col-span-1 font-medium text-sm truncate text-(--ui-text-highlighted)" :title="t.title">{{ t.title }}</span>
                  <span class="row-start-1 col-start-2 xl:row-start-auto xl:col-start-auto min-w-0 flex">
                    <TicketTypeChip :name="t.ticket_type.name" :icon="t.ticket_type.icon" :color="t.ticket_type.color" />
                  </span>
                  <span class="row-start-1 col-start-3 justify-self-end xl:row-start-auto xl:col-start-auto xl:justify-self-start">
                    <PriorityBadge :priority="t.priority" />
                  </span>
                  <span class="row-start-3 col-span-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 min-w-0 xl:contents">
                    <span class="flex items-center gap-2 min-w-0">
                      <span class="text-sm truncate text-(--ui-text)">{{ displayName(t.requester) }}</span>
                      <SourceChip v-if="t.channel !== 'web'" :channel="t.channel" />
                    </span>
                    <span class="flex items-center gap-2 min-w-0 text-sm">
                      <template v-if="t.assignee">
                        <UserAvatar :person="t.assignee" size="sm" />
                        <span class="truncate text-(--ui-text)">{{ displayName(t.assignee) }}</span>
                      </template>
                      <span v-else class="text-(--ui-text-muted)">Unassigned</span>
                    </span>
                    <time class="text-[13px] text-(--ui-text-muted) whitespace-nowrap" :datetime="t.updated_at" :title="formatDateTime(t.updated_at)">
                      {{ timeAgo(t.updated_at) }}
                    </time>
                  </span>
                </NuxtLink>
              </li>
            </ul>
            <p v-if="shownIn(g.tickets, g.count)" class="px-4 pt-3 pb-2 text-[13px] text-(--ui-text-muted)">
              {{ shownIn(g.tickets, g.count) }}
            </p>
          </template>
        </div>
      </section>
      <div v-if="list.next_cursor" class="flex flex-col items-center gap-2">
        <UButton variant="outline" size="lg" :loading="loadingMore" @click="loadMore">
          Load more
        </UButton>
        <p v-if="moreFailed" class="text-sm text-(--ui-error)" role="alert">
          More tickets could not be loaded. Try again.
        </p>
      </div>
    </div>
  </AppPage>
</template>
