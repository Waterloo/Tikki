<script setup lang="ts">
defineProps<{ title: string, description?: string }>()
</script>

<template>
  <section class="rounded-[14px] border border-(--ui-border) bg-(--ui-bg) p-5 sm:p-6 flex flex-col gap-5">
    <header class="flex flex-col gap-1">
      <h2 class="text-base font-semibold text-(--ui-text-highlighted)">
        {{ title }}
      </h2>
      <p v-if="description" class="text-sm text-(--ui-text-muted)">
        {{ description }}
      </p>
    </header>
    <slot />
  </section>
</template>
