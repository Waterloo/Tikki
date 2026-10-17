<script setup lang="ts">
interface Ticket {
  number: number
  ref: string
  title: string
  ticket_type: { name: string, icon?: string, color?: string }
  channel: 'web' | 'ai' | 'api'
  created_at: string
}

const tickets = ref<Ticket[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

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
  <UDashboardPanel id="my-tickets" :ui="{ body: 'bg-(--ui-bg-muted)' }">
    <template #header>
      <UDashboardNavbar title="My tickets" />
    </template>

    <template #body>
      <div class="w-full max-w-5xl mx-auto flex flex-col gap-4">
        <ListSkeleton v-if="state === 'loading'" />

        <ErrorState v-else-if="state === 'error'" title="Your tickets could not be loaded." description="Check your connection, then try again." @retry="load" />

        <EmptyState
          v-else-if="tickets.length === 0"
          icon="i-lucide-ticket"
          title="You have no tickets yet"
          description="Add this site to Claude as a custom connector and say, for example, “raise a bug: the export button fails”."
        />

        <ul v-else class="rounded-xl border border-(--ui-border) bg-(--ui-bg) divide-y divide-(--ui-border) overflow-hidden">
          <li v-for="t in tickets" :key="t.number" class="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[6rem_minmax(0,1fr)_11rem_6rem_4rem] items-center gap-x-4 gap-y-1 px-4 py-3">
            <TicketRef :value="t.ref" />
            <span class="font-medium truncate col-span-2 sm:col-span-1 row-start-2 sm:row-start-auto col-start-1" :title="t.title">{{ t.title }}</span>
            <TicketTypeChip :name="t.ticket_type.name" :icon="t.ticket_type.icon" :color="t.ticket_type.color" />
            <span class="flex sm:block justify-end col-start-3 sm:col-start-auto row-start-1 sm:row-start-auto">
              <SourceChip :channel="t.channel" />
            </span>
            <time class="hidden sm:block text-xs text-(--ui-text-muted) text-right" :datetime="t.created_at">
              {{ dateFormat.format(new Date(t.created_at)) }}
            </time>
          </li>
        </ul>
      </div>
    </template>
  </UDashboardPanel>
</template>
