<script setup lang="ts">
useWebMcpTools()
</script>

<template>
  <!-- rem with equal sizes: a fixed 248 px sidebar, as on the canvas. -->
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      :default-size="15.5"
      :min-size="15.5"
      :max-size="15.5"
      :ui="{
        root: 'bg-(--app-sidebar) border-r border-(--ui-border)',
        header: 'h-auto px-3.5 pt-5 pb-1',
        body: 'px-3.5 pt-4 gap-6',
        footer: 'px-3.5 py-3 border-t border-(--ui-border)',
      }"
    >
      <template #header>
        <OrgMark class="px-2" />
      </template>

      <template #default>
        <SidebarNav />
        <ClaudeHint />
      </template>

      <template #footer>
        <UserMenu />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
