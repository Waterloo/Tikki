<script setup lang="ts">
const session = authClient.useSession()
const route = useRoute()

const items = computed(() => {
  const role = (session.value.data?.user as { role?: unknown } | undefined)?.role
  return navigationFor(isRole(role) ? role : undefined)
})
</script>

<template>
  <nav aria-label="Main" class="flex flex-col gap-0.5">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      :aria-current="route.path === item.to ? 'page' : undefined"
      class="flex items-center gap-2.5 min-h-10 px-2.5 rounded-lg border text-sm transition-colors"
      :class="route.path === item.to
        ? 'bg-(--ui-bg) border-(--ui-border) font-medium text-(--ui-text-highlighted)'
        : 'border-transparent text-(--ui-text) hover:bg-(--app-hover)'"
    >
      <UIcon :name="item.icon" class="size-[18px] shrink-0" />
      <span class="truncate">{{ item.label }}</span>
    </NuxtLink>
  </nav>
</template>
