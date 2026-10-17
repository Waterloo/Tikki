<script setup lang="ts">
interface Ticket {
  number: number
  ref: string
  title: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  ticket_type: { name: string, icon?: string, color?: string }
  channel: 'web' | 'ai' | 'api'
  created_at: string
}

const tickets = ref<Ticket[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

// One grid for the header and the rows, so the columns line up. Below `md` each row becomes a card.
const COLUMNS = 'md:grid-cols-[96px_minmax(220px,1fr)_160px_96px_120px_72px]'

async function load() {
  state.value = 'loading'
  try {
    const res = await $fetch<{ data: Ticket[] }>('/api/v1/tickets', { query: { requester: 'me' } })
    tickets.value = res.data
    state.value = 'ready'
  } catch (e: unknown) {
    if ((e as { status?: number }).status === 401) return navigateTo('/sign-in')
    state.value = 'error'
  }
}

onMounted(load)
</script>

<template>
  <AppPage id="my-tickets" title="My tickets">
    <PageHeader
      title="My tickets"
      subtitle="Everything you raised, from the web and from Claude."
      :breadcrumb="[{ label: 'Tickets' }, { label: 'My tickets' }]"
    >
      <template #actions>
        <UButton to="/tickets/new" icon="i-lucide-plus" size="lg">
          New ticket
        </UButton>
      </template>
    </PageHeader>

    <ListSkeleton v-if="state === 'loading'" />

    <ErrorState v-else-if="state === 'error'" title="Your tickets could not be loaded." description="Check your connection, then try again." @retry="load" />

    <EmptyState
      v-else-if="tickets.length === 0"
      icon="i-lucide-ticket"
      title="You have no tickets yet"
      description="Create one here, or add this site to Claude as a custom connector and say, for example, “raise a bug: the export button fails”."
    >
      <UButton to="/tickets/new" icon="i-lucide-plus" size="lg">
        New ticket
      </UButton>
    </EmptyState>

    <section v-else aria-label="My tickets" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-2">
      <div class="hidden md:grid items-center gap-4 px-4 min-h-10 text-[13px] text-(--ui-text-muted)" :class="COLUMNS" aria-hidden="true">
        <span>Ticket</span><span>Title</span><span>Type</span><span>Priority</span><span>Source</span><span class="text-right">Created</span>
      </div>
      <ul class="flex flex-col">
        <li
          v-for="t in tickets"
          :key="t.number"
          class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 md:gap-4 px-4 py-3 md:py-0 md:min-h-[52px] rounded-lg border-t border-(--ui-border-muted) first:border-t-0 md:first:border-t hover:bg-(--app-row-hover)"
          :class="COLUMNS"
        >
          <TicketRef :value="t.ref" />
          <span class="font-medium text-sm truncate text-(--ui-text-highlighted) col-span-3 md:col-span-1 row-start-2 md:row-start-auto col-start-1 md:col-start-auto" :title="t.title">{{ t.title }}</span>
          <TicketTypeChip :name="t.ticket_type.name" :icon="t.ticket_type.icon" :color="t.ticket_type.color" />
          <span class="justify-self-end md:justify-self-start">
            <PriorityBadge :priority="t.priority" />
          </span>
          <span class="hidden md:block">
            <SourceChip :channel="t.channel" />
          </span>
          <time class="hidden md:block text-[13px] text-(--ui-text-muted) text-right whitespace-nowrap" :datetime="t.created_at">
            {{ dateFormat.format(new Date(t.created_at)) }}
          </time>
        </li>
      </ul>
    </section>
  </AppPage>
</template>
