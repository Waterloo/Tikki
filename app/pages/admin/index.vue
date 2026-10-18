<script setup lang="ts">
/** The Settings menu as a page (issue 43). On a phone it is the list; a desktop has the menu next to each page. */
definePageMeta({
  roles: ['admin'],
  middleware: () => {
    if (window.matchMedia('(min-width: 1024px)').matches) return navigateTo('/settings', { replace: true })
  },
})
</script>

<template>
  <AppPage id="settings-home" title="Settings">
    <PageHeader title="Settings" subtitle="Set up your organization, people, ticket types and integrations." />
    <SettingsMenu list />
  </AppPage>
</template>
