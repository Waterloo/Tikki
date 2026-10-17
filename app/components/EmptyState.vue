<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  description?: string
  icon?: string
}>(), {
  icon: 'i-lucide-inbox',
})
</script>

<template>
  <div class="flex flex-col items-center text-center gap-2 px-6 py-12 rounded-xl border border-(--ui-border) bg-(--ui-bg)">
    <UIcon :name="icon" class="size-7 text-(--ui-text-dimmed)" aria-hidden="true" />
    <p class="font-semibold">
      {{ title }}
    </p>
    <p v-if="description" class="max-w-md text-sm text-(--ui-text-muted)">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="mt-2 flex flex-wrap justify-center gap-2">
      <slot />
    </div>
  </div>
</template>
