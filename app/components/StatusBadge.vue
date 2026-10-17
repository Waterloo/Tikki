<script setup lang="ts">
import type { Status } from '~/types/tickets'

defineProps<{ status: Status }>()
</script>

<template>
  <span class="inline-flex items-center gap-1.5 min-h-6 px-2.5 rounded-full text-xs font-medium whitespace-nowrap" :class="STATUS_CLASS[status.category]">
    <StatusIcon :category="status.category" class="size-3.5" />
    {{ status.name }}
  </span>
</template>
