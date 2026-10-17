<script setup lang="ts">
interface Ticket {
  number: number
  ref: string
  title: string
  ticket_type: { name: string }
  channel: 'web' | 'ai' | 'api'
  created_at: string
}

const session = authClient.useSession()
const tickets = ref<Ticket[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')

const channelLabel = { web: 'Web', ai: 'Claude', api: 'API' } as const

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

async function signOut() {
  await authClient.signOut()
  await navigateTo('/sign-in')
}

onMounted(load)
</script>

<template>
  <div class="max-w-3xl mx-auto p-4 sm:p-8">
    <header class="flex items-center justify-between mb-6">
      <h1 class="text-xl font-semibold">
        My tickets
      </h1>
      <div class="flex items-center gap-3 text-sm text-(--ui-text-muted)">
        <span v-if="session.data">{{ session.data.user.email }}</span>
        <UButton size="sm" to="/tickets/new" icon="i-lucide-plus">
          New ticket
        </UButton>
        <UButton size="sm" color="neutral" variant="ghost" @click="signOut">
          Sign out
        </UButton>
      </div>
    </header>

    <p v-if="state === 'loading'" class="text-(--ui-text-muted)">
      Loading tickets…
    </p>
    <UAlert v-else-if="state === 'error'" color="error" variant="subtle" title="The tickets could not be loaded.">
      <template #actions>
        <UButton size="xs" @click="load">
          Try again
        </UButton>
      </template>
    </UAlert>
    <UCard v-else-if="tickets.length === 0">
      <p class="font-medium">
        You have no tickets yet.
      </p>
      <p class="text-sm text-(--ui-text-muted) mt-1">
        Select "New ticket", or add this site to Claude as a custom connector and say, for example, "raise a bug: the export button fails".
      </p>
    </UCard>
    <ul v-else class="divide-y divide-(--ui-border) border border-(--ui-border) rounded-lg bg-(--ui-bg)">
      <li v-for="t in tickets" :key="t.number" class="flex items-center gap-4 px-4 py-3">
        <span class="font-mono text-sm text-(--ui-text-muted) w-20 shrink-0">{{ t.ref }}</span>
        <span class="flex-1 truncate">{{ t.title }}</span>
        <UBadge color="neutral" variant="subtle">
          {{ channelLabel[t.channel] }}
        </UBadge>
        <time class="text-xs text-(--ui-text-muted) w-24 text-right shrink-0" :datetime="t.created_at">
          {{ new Date(t.created_at).toLocaleDateString() }}
        </time>
      </li>
    </ul>
  </div>
</template>
