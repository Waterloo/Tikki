<script setup lang="ts">
useWebMcpTools()
const { role } = useCurrentUser()
const route = useRoute()
const settingsArea = computed(() => role.value === 'admin' && isSettingsPath(route.path))
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
        footer: 'flex-col items-stretch gap-1 px-3.5 py-3 border-t border-(--ui-border)',
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
        <SidebarLink v-if="role === 'admin'" :to="SETTINGS_HOME" :current="isSettingsPath(route.path)">
          <UIcon name="i-lucide-settings" class="size-[18px] shrink-0" />
          <span class="truncate flex-1">Settings</span>
        </SidebarLink>
        <UserMenu />
      </template>
    </UDashboardSidebar>

    <!-- On a phone the menu is its own page (`/admin`), so the panel shows only from lg. -->
    <UDashboardPanel
      v-if="settingsArea"
      id="settings-menu"
      :default-size="15"
      :min-size="15"
      :max-size="15"
      class="hidden lg:flex"
      :ui="{ body: 'px-3.5 pt-6 sm:px-3.5 sm:pt-6' }"
    >
      <template #body>
        <p class="px-2.5 text-base font-semibold text-(--ui-text-highlighted)">
          Settings
        </p>
        <SettingsMenu />
      </template>
    </UDashboardPanel>

    <slot />
  </UDashboardGroup>
</template>
