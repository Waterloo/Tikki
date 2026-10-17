<script setup lang="ts">
withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false })
const org = useOrganization()
</script>

<template>
  <div class="flex items-center gap-3 min-w-0">
    <span class="size-9 shrink-0 rounded-md bg-(--ui-bg-inverted) text-(--ui-bg) flex items-center justify-center font-semibold" aria-hidden="true">
      {{ org.initial }}
    </span>
    <span v-if="!collapsed" class="flex flex-col min-w-0">
      <span class="font-semibold text-sm truncate">{{ org.name }}</span>
      <span class="text-xs text-(--ui-text-muted) truncate">{{ org.subtitle }}</span>
    </span>
  </div>
</template>
