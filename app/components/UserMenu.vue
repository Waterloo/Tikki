<script setup lang="ts">
const { user, role } = useCurrentUser()

const roleLabel = { admin: 'Admin', agent: 'Agent', requester: 'Requester' } as const

async function signOut() {
  await authClient.signOut()
  await navigateTo('/sign-in')
}
</script>

<template>
  <div v-if="user" class="flex items-center gap-2.5 w-full min-w-0">
    <UserAvatar :person="user" />
    <div class="flex flex-col min-w-0 flex-1">
      <span class="text-sm font-medium truncate text-(--ui-text-highlighted)">{{ displayName(user) }}</span>
      <span class="text-xs text-(--ui-text-muted) truncate">{{ role ? roleLabel[role] : '' }}</span>
    </div>
    <UTooltip text="Sign out">
      <UButton icon="i-lucide-log-out" variant="ghost" aria-label="Sign out" @click="signOut" />
    </UTooltip>
  </div>
</template>
