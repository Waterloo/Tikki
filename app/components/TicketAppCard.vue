<script setup lang="ts">
import type { TicketAppFrame } from '~/types/ticket-apps'

/** A sidebar Ticket App: a card with the app name and a collapse button. It loads when the ticket opens. */
defineProps<{ app: TicketAppFrame, ticketRef: string, ticketVersion: string }>()
defineEmits<{ refresh: [] }>()

const open = ref(true)
const id = useId()
</script>

<template>
  <section :aria-labelledby="`${id}-title`" class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-[18px] flex flex-col gap-3 min-w-0">
    <div class="flex items-center justify-between gap-2">
      <h2 :id="`${id}-title`" class="text-sm font-semibold text-(--ui-text-highlighted) truncate">
        {{ app.name }}
      </h2>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        :icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        :aria-label="open ? `Collapse ${app.name}` : `Expand ${app.name}`"
        :aria-expanded="open"
        :aria-controls="`${id}-body`"
        @click="open = !open"
      />
    </div>
    <!-- v-show, so a collapsed app keeps its state. -->
    <div v-show="open" :id="`${id}-body`">
      <TicketAppFrame :app="app" placement="sidebar" :ticket-ref="ticketRef" :ticket-version="ticketVersion" @refresh="$emit('refresh')" />
    </div>
  </section>
</template>
