<script setup lang="ts">
/** The Settings menu (issue 43): a panel next to the page on a desktop, and the whole page at `/admin` on a phone. */
defineProps<{ list?: boolean }>()
const { role } = useCurrentUser()
const route = useRoute()
const groups = computed(() => settingsFor(role.value))
</script>

<template>
  <nav aria-label="Settings" class="flex flex-col gap-5">
    <div v-for="group in groups" :key="group.label" role="group" :aria-labelledby="`settings-${group.label}`" class="flex flex-col gap-0.5">
      <h2 :id="`settings-${group.label}`" class="px-2.5 pb-1 text-xs font-medium text-(--ui-text-muted)">
        {{ group.label }}
      </h2>
      <SidebarLink
        v-for="item in group.items"
        :key="item.to"
        :to="item.to"
        :external="item.external"
        :current="isSettingsCurrent(item, route.path)"
        :class="list && 'min-h-12'"
      >
        <UIcon :name="item.icon" class="size-[18px] shrink-0" />
        <span class="truncate flex-1">{{ item.label }}</span>
        <template v-if="item.external">
          <UIcon name="i-lucide-external-link" class="size-4 shrink-0 text-(--ui-text-muted)" />
          <span class="sr-only">(opens in a new tab)</span>
        </template>
        <UIcon v-else-if="list" name="i-lucide-chevron-right" class="size-4 shrink-0 text-(--ui-text-muted)" />
      </SidebarLink>
    </div>
  </nav>
</template>
