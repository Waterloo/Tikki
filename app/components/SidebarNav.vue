<script setup lang="ts">
const { role } = useCurrentUser()
const route = useRoute()

const items = computed(() => navigationFor(role.value))
</script>

<template>
  <nav aria-label="Main" class="flex flex-col gap-0.5">
    <!-- fullPath, so "All tickets" and "Assigned to me" (the same page with a filter) are told apart. -->
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      :aria-current="route.fullPath === item.to ? 'page' : undefined"
      class="flex items-center gap-2.5 min-h-10 px-2.5 rounded-lg border text-sm transition-colors"
      :class="route.fullPath === item.to
        ? 'bg-(--ui-bg) border-(--ui-border) font-medium text-(--ui-text-highlighted)'
        : 'border-transparent text-(--ui-text) hover:bg-(--app-hover)'"
    >
      <UIcon :name="item.icon" class="size-[18px] shrink-0" />
      <span class="truncate">{{ item.label }}</span>
    </NuxtLink>
  </nav>
</template>
