<script setup lang="ts">
import type { Notice, NoticeKind, NoticeList, Preference } from '~/types/notifications'

const LABEL: Record<Preference['key'], { label: string, note?: string }> = {
  assigned: { label: 'A ticket is assigned to me', note: 'Always on' },
  team_ticket: { label: 'A ticket arrives for, or moves to, my team' },
  public_comment: { label: 'Someone replies on my tickets', note: 'Public comments' },
  internal_comment: { label: 'Someone adds an internal note on my tickets' },
  status_changed: { label: 'The status of my ticket changes' },
  webhook: { label: 'A webhook endpoint fails', note: 'Admins only' },
}

// Icon and tile colors from the canvas, with a dark variant of each.
const KIND: Record<NoticeKind, { icon: string, tile: string }> = {
  public_comment: { icon: 'i-lucide-message-circle', tile: 'bg-[#eaf1fd] text-[#1a4fb4] dark:bg-[#1c2a45] dark:text-[#a9c3f0]' },
  ticket_created: { icon: 'i-lucide-ticket-plus', tile: 'bg-[#eef0f3] text-[#2b2e35] dark:bg-[#26282e] dark:text-[#c3c6cc]' },
  moved_to_team: { icon: 'i-lucide-arrow-right-left', tile: 'bg-[#eef0f3] text-[#2b2e35] dark:bg-[#26282e] dark:text-[#c3c6cc]' },
  status_changed: { icon: 'i-lucide-refresh-cw', tile: 'bg-[#eef0f3] text-[#2b2e35] dark:bg-[#26282e] dark:text-[#c3c6cc]' },
  assigned: { icon: 'i-lucide-user', tile: 'bg-[#e7f5ec] text-[#1b6136] dark:bg-[#12281b] dark:text-[#7fd19c]' },
  internal_comment: { icon: 'i-lucide-lock', tile: 'bg-[#fff3e3] text-[#7a3e00] dark:bg-[#2e1d0d] dark:text-[#f4b77a]' },
  webhook_failing: { icon: 'i-lucide-triangle-alert', tile: 'bg-[#fdecea] text-[#a3261b] dark:bg-[#3a1512] dark:text-[#f19a92]' },
  webhook_disabled: { icon: 'i-lucide-triangle-alert', tile: 'bg-[#fdecea] text-[#a3261b] dark:bg-[#3a1512] dark:text-[#f19a92]' },
}

const toast = useToast()
const { user } = useCurrentUser()
const { count: unreadCount } = useUnreadCount()

const filter = ref<'all' | 'unread'>('all')
const notices = ref<Notice[]>([])
const nextCursor = ref<number | null>(null)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const loadingMore = ref(false)
const markingAll = ref(false)

const prefs = ref<Preference[]>([])
const prefsState = ref<'loading' | 'ready' | 'error'>('loading')

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const timeOfDay = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

function groupLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (dayKey(d) === dayKey(now)) return 'Today'
  if (dayKey(d) === dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday'
  return dayLabel.format(d)
}

const groups = computed(() => {
  const out: { label: string, items: Notice[] }[] = []
  for (const n of notices.value) {
    const label = groupLabel(n.created_at)
    const last = out.at(-1)
    if (last?.label === label) last.items.push(n)
    else out.push({ label, items: [n] })
  }
  return out
})

const when = (n: Notice) => groupLabel(n.created_at) === 'Today' ? timeAgo(n.created_at) : timeOfDay.format(new Date(n.created_at))

function fail(e: unknown) {
  if ((e as { status?: number }).status === 401) return navigateTo('/sign-in')
}

async function load() {
  state.value = 'loading'
  try {
    const res = await $fetch<NoticeList>('/api/v1/notifications', { query: { filter: filter.value } })
    notices.value = res.data
    nextCursor.value = res.next_cursor
    unreadCount.value = res.unread_count
    state.value = 'ready'
  } catch (e) {
    fail(e)
    state.value = 'error'
  }
}

async function loadMore() {
  if (nextCursor.value === null || loadingMore.value) return
  loadingMore.value = true
  try {
    const res = await $fetch<NoticeList>('/api/v1/notifications', { query: { filter: filter.value, cursor: nextCursor.value } })
    notices.value.push(...res.data)
    nextCursor.value = res.next_cursor
    unreadCount.value = res.unread_count
  } catch (e) {
    fail(e)
    toast.add({ title: 'More notifications could not be loaded.', color: 'error' })
  } finally {
    loadingMore.value = false
  }
}

function show(next: 'all' | 'unread') {
  if (filter.value === next) return
  filter.value = next
  load()
}

async function markAll() {
  markingAll.value = true
  try {
    await $fetch('/api/v1/notifications/read-all', { method: 'POST' })
    unreadCount.value = 0
    notices.value = filter.value === 'unread' ? [] : notices.value.map(n => ({ ...n, read: true }))
    nextCursor.value = null
  } catch (e) {
    fail(e)
    toast.add({ title: 'The notifications were not marked as read.', description: 'Check your connection, then try again.', color: 'error' })
  } finally {
    markingAll.value = false
  }
}

// The link opens the target at once. The read mark is sent alongside and is not awaited.
function open(n: Notice) {
  if (n.read) return
  n.read = true
  unreadCount.value = Math.max(0, unreadCount.value - 1)
  $fetch(`/api/v1/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {})
}

async function loadPrefs() {
  prefsState.value = 'loading'
  try {
    prefs.value = (await $fetch<{ data: Preference[] }>('/api/v1/notifications/preferences')).data
    prefsState.value = 'ready'
  } catch (e) {
    fail(e)
    prefsState.value = 'error'
  }
}

async function setPref(p: Preference, enabled: boolean) {
  const before = p.enabled
  p.enabled = enabled
  try {
    prefs.value = (await $fetch<{ data: Preference[] }>('/api/v1/notifications/preferences', { method: 'PATCH', body: { [p.key]: enabled } })).data
  } catch (e) {
    fail(e)
    p.enabled = before
    toast.add({ title: 'The preference was not saved.', description: 'Check your connection, then try again.', color: 'error' })
  }
}

onMounted(() => {
  load()
  loadPrefs()
})
</script>

<template>
  <AppPage id="inbox" title="Inbox">
    <PageHeader
      title="Inbox"
      subtitle="Everything that needs you. The Inbox always gets every notification, even when email is off."
    />

    <div class="flex flex-wrap items-start gap-6">
      <div class="flex-[999_1_520px] min-w-0 flex flex-col gap-3.5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Show" class="flex gap-1 p-1 rounded-xl bg-(--app-segment)">
            <button
              v-for="opt in [{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }] as const"
              :key="opt.key"
              type="button"
              :aria-pressed="filter === opt.key"
              class="flex items-center gap-2 min-h-9 px-3.5 rounded-[9px] border text-sm font-medium cursor-pointer focus-visible:outline-2 focus-visible:outline-(--ui-primary)"
              :class="filter === opt.key
                ? 'bg-(--ui-bg) border-(--ui-border) text-(--ui-text-highlighted) shadow-xs'
                : 'border-transparent text-(--ui-text-toned)'"
              @click="show(opt.key)"
            >
              {{ opt.label }}
              <span v-if="opt.key === 'unread'" class="text-xs text-(--ui-text-muted)">{{ unreadCount }}</span>
            </button>
          </div>
          <UButton color="neutral" variant="outline" icon="i-lucide-check" size="lg" :loading="markingAll" :disabled="unreadCount === 0" @click="markAll">
            Mark all as read
          </UButton>
        </div>

        <ListSkeleton v-if="state === 'loading'" />

        <ErrorState v-else-if="state === 'error'" title="Your notifications could not be loaded." description="Check your connection, then try again." @retry="load" />

        <EmptyState
          v-else-if="notices.length === 0"
          icon="i-lucide-circle-check"
          title="You are up to date"
          description="New notifications show here as they happen."
        />

        <template v-else>
          <section v-for="g in groups" :key="g.label" :aria-label="g.label" class="flex flex-col gap-2">
            <h2 class="px-1 text-[13px] font-medium text-(--ui-text-muted)">
              {{ g.label }}
            </h2>
            <ul class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) overflow-hidden">
              <li v-for="n in g.items" :key="n.id" class="border-t border-(--ui-border-muted) first:border-t-0">
                <NuxtLink
                  :to="n.href"
                  class="flex items-start gap-3.5 px-4 py-3.5 hover:bg-(--app-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-primary)"
                  :class="n.read ? '' : 'bg-(--app-similar-bg)'"
                  @click="open(n)"
                >
                  <span class="size-[34px] shrink-0 rounded-[10px] flex items-center justify-center" :class="KIND[n.kind].tile" aria-hidden="true">
                    <UIcon :name="KIND[n.kind].icon" class="size-4" />
                  </span>
                  <span class="flex-1 min-w-0 flex flex-col gap-1">
                    <span class="text-sm leading-snug text-(--ui-text-highlighted) [overflow-wrap:anywhere]" :class="n.read ? 'font-medium' : 'font-semibold'">{{ n.head }}</span>
                    <span v-if="n.body" class="text-sm text-(--ui-text-toned) truncate">{{ n.body }}</span>
                    <span class="flex flex-wrap items-center gap-2 text-xs text-(--ui-text-muted)">
                      <TicketTypeChip v-if="n.ticket" :name="n.ticket.ticket_type.name" :icon="n.ticket.ticket_type.icon" :color="n.ticket.ticket_type.color" />
                      <PriorityBadge v-if="n.ticket?.priority === 'urgent'" priority="urgent" />
                      <span>{{ when(n) }}</span>
                    </span>
                  </span>
                  <span v-if="!n.read" class="shrink-0 mt-1.5 size-2.5 rounded-full bg-(--ui-primary)" role="img" aria-label="Unread" />
                </NuxtLink>
              </li>
            </ul>
          </section>
          <div v-if="nextCursor !== null" class="flex justify-center">
            <UButton color="neutral" variant="outline" size="lg" :loading="loadingMore" @click="loadMore">
              Show older
            </UButton>
          </div>
        </template>
      </div>

      <aside aria-labelledby="email-h" class="flex-[1_1_300px] min-w-0 rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-[18px] flex flex-col gap-3.5">
        <div class="flex flex-col gap-1">
          <h2 id="email-h" class="text-[15px] font-semibold text-(--ui-text-highlighted)">
            Email me when
          </h2>
          <span v-if="user?.email" class="text-[13px] text-(--ui-text-muted) [overflow-wrap:anywhere]">Emails go to {{ user.email }}.</span>
        </div>
        <ErrorState v-if="prefsState === 'error'" title="Your preferences could not be loaded." @retry="loadPrefs" />
        <div v-else-if="prefsState === 'loading'" class="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
          <USkeleton v-for="n in 4" :key="n" class="h-9 w-full" />
        </div>
        <template v-else>
          <div
            v-for="p in prefs"
            :key="p.key"
            class="flex items-center justify-between gap-3 min-h-11 border-t border-(--ui-border-muted) pt-2.5"
          >
            <label :for="`pref-${p.key}`" class="flex flex-col gap-0.5 text-sm cursor-pointer">
              <span>{{ LABEL[p.key].label }}</span>
              <span v-if="LABEL[p.key].note" class="text-xs text-(--ui-text-muted)">{{ LABEL[p.key].note }}</span>
            </label>
            <USwitch :id="`pref-${p.key}`" :model-value="p.enabled" :disabled="p.locked" @update:model-value="setPref(p, $event)" />
          </div>
        </template>
      </aside>
    </div>
  </AppPage>
</template>
