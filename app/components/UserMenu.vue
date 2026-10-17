<script setup lang="ts">
const session = authClient.useSession()

const user = computed(() => session.value.data?.user)
const role = computed(() => {
  const value = (user.value as { role?: unknown } | undefined)?.role
  return isRole(value) ? value : undefined
})
const roleLabel = { admin: 'Admin', agent: 'Agent', requester: 'Requester' } as const

async function signOut() {
  await authClient.signOut()
  await navigateTo('/sign-in')
}
</script>

<template>
  <div v-if="user" class="flex items-center gap-3 w-full min-w-0">
    <UAvatar :alt="user.name || user.email" size="sm" />
    <div class="flex flex-col min-w-0 flex-1">
      <span class="text-sm font-medium truncate">{{ user.name || user.email }}</span>
      <span class="text-xs text-(--ui-text-muted) truncate">{{ role ? roleLabel[role] : '' }}</span>
    </div>
    <UTooltip text="Sign out">
      <UButton icon="i-lucide-log-out" variant="ghost" aria-label="Sign out" @click="signOut" />
    </UTooltip>
  </div>
</template>
