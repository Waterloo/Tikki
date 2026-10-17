<script setup lang="ts">
const session = authClient.useSession()
const items = computed(() => {
  const role = (session.value.data?.user as { role?: unknown } | undefined)?.role
  return navigationFor(isRole(role) ? role : undefined)
})
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar
      :ui="{ root: 'bg-(--ui-bg-muted)', footer: 'border-t border-(--ui-border)' }"
    >
      <template #header>
        <OrgMark />
      </template>

      <template #default>
        <UNavigationMenu :items="items" orientation="vertical" />
      </template>

      <template #footer>
        <UserMenu />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
