<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 4 })
</script>

<template>
  <div class="rounded-xl border border-(--ui-border) bg-(--ui-bg) divide-y divide-(--ui-border)" aria-busy="true" aria-label="Loading">
    <div v-for="n in rows" :key="n" class="flex items-center gap-4 px-4 py-3.5">
      <USkeleton class="h-4 w-16" />
      <USkeleton class="h-4 flex-1" />
      <USkeleton class="h-5 w-20 hidden sm:block" />
    </div>
  </div>
</template>
