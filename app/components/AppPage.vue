<script setup lang="ts">
/** One page in the app shell: a phone-only top bar with the menu button, then the canvas page layout. */
defineProps<{ id: string, title: string }>()
</script>

<template>
  <UDashboardPanel :id="id" :ui="{ body: 'bg-(--ui-bg-muted) p-0 sm:p-0' }">
    <template #header>
      <UDashboardNavbar :title="title" class="lg:hidden bg-(--ui-bg)" />
    </template>
    <template #body>
      <div class="w-full px-4 sm:px-8 pt-6 pb-14 flex flex-col gap-5">
        <slot />
      </div>
    </template>
  </UDashboardPanel>
</template>
