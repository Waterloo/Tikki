<script setup lang="ts">
const { role } = useCurrentUser()
const route = useRoute()

const items = computed(() => navigationFor(role.value))
</script>

<template>
  <nav aria-label="Main" class="flex flex-col gap-0.5">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      :aria-current="isCurrent(item, route.fullPath, route.path) ? 'page' : undefined"
      class="flex items-center gap-2.5 min-h-10 px-2.5 rounded-lg border text-sm transition-colors"
      :class="isCurrent(item, route.fullPath, route.path)
        ? 'bg-(--ui-bg) border-(--ui-border) font-medium text-(--ui-text-highlighted)'
        : 'border-transparent text-(--ui-text) hover:bg-(--app-hover)'"
    >
      <UIcon :name="item.icon" class="size-[18px] shrink-0" />
      <span class="truncate">{{ item.label }}</span>
    </NuxtLink>
  </nav>
</template>
