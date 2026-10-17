<script setup lang="ts">
const org = useOrganization()
</script>

<template>
  <div class="flex items-center gap-3 min-w-0">
    <span class="size-9 shrink-0 rounded-[10px] bg-(--ui-bg-inverted) text-(--ui-bg) flex items-center justify-center text-base font-semibold" aria-hidden="true">
      {{ org.initial }}
    </span>
    <span class="flex flex-col gap-0.5 min-w-0">
      <span class="text-[15px] font-semibold truncate text-(--ui-text-highlighted)">{{ org.name }}</span>
      <span class="text-xs text-(--ui-text-muted) truncate">{{ org.subtitle }}</span>
    </span>
  </div>
</template>
