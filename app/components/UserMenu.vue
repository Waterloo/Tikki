<script setup lang="ts">
const session = authClient.useSession()

const user = computed(() => session.value.data?.user)
const role = computed(() => {
  const value = (user.value as { role?: unknown } | undefined)?.role
  return isRole(value) ? value : undefined
})
const displayName = computed(() => user.value?.name || user.value?.email || '')
const initials = computed(() => {
  const source = user.value?.name || user.value?.email?.split('@')[0] || ''
  return source.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('')
})
const roleLabel = { admin: 'Admin', agent: 'Agent', requester: 'Requester' } as const

async function signOut() {
  await authClient.signOut()
  await navigateTo('/sign-in')
}
</script>

<template>
  <div v-if="user" class="flex items-center gap-2.5 w-full min-w-0">
    <span class="size-8 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold bg-[#dce7fb] text-[#1a4fb4] dark:bg-[#1c2a45] dark:text-[#a9c3f0]" aria-hidden="true">
      {{ initials }}
    </span>
    <div class="flex flex-col min-w-0 flex-1">
      <span class="text-sm font-medium truncate text-(--ui-text-highlighted)">{{ displayName }}</span>
      <span class="text-xs text-(--ui-text-muted) truncate">{{ role ? roleLabel[role] : '' }}</span>
    </div>
    <UTooltip text="Sign out">
      <UButton icon="i-lucide-log-out" variant="ghost" aria-label="Sign out" @click="signOut" />
    </UTooltip>
  </div>
</template>
