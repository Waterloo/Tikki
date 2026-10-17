<script setup lang="ts">
import type { TicketList, TicketSummary } from '~/types/tickets'

const tickets = ref<TicketSummary[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')

// One grid for the header and the rows, so the columns line up. Below `xl` each row becomes a card.
const COLUMNS = 'xl:grid-cols-[88px_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_84px_minmax(0,0.9fr)_72px]'

async function load() {
  state.value = 'loading'
  try {
    const res = await $fetch<TicketList>('/api/v1/tickets', { query: { requester: 'me' } })
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
      <div class="hidden xl:grid items-center gap-4 px-4 min-h-10 text-[13px] text-(--ui-text-muted)" :class="COLUMNS" aria-hidden="true">
        <span>Ticket</span><span>Title</span><span>Type</span><span>Status</span><span>Priority</span><span>Source</span><span class="text-right">Created</span>
      </div>
      <ul class="flex flex-col">
        <li v-for="t in tickets" :key="t.number" class="border-t border-(--ui-border-muted) first:border-t-0 xl:first:border-t">
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
            <span class="row-start-3 col-span-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 xl:contents">
              <span><StatusBadge :status="t.status" /></span>
              <span class="hidden xl:block"><PriorityBadge :priority="t.priority" /></span>
              <span><SourceChip :channel="t.channel" /></span>
              <time class="text-[13px] text-(--ui-text-muted) xl:text-right whitespace-nowrap" :datetime="t.created_at">
                {{ formatDay(t.created_at) }}
              </time>
            </span>
            <span class="row-start-1 col-start-3 justify-self-end xl:hidden">
              <PriorityBadge :priority="t.priority" />
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </AppPage>
</template>
