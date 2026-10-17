<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const clientId = String(route.query.client_id ?? '')
const scopes = String(route.query.scope ?? '').split(' ').filter(Boolean)
const clientName = ref<string>('An application')
const error = ref<string | null>(null)
const busy = ref(false)

onMounted(async () => {
  const { data } = await authClient.oauth2.publicClient({ query: { client_id: clientId } })
  if (data?.client_name) clientName.value = data.client_name
})

async function answer(accept: boolean) {
  busy.value = true
  error.value = null
  const { data, error: err } = await authClient.oauth2.consent({ accept })
  busy.value = false
  if (err) {
    error.value = err.message ?? 'Something went wrong.'
    return
  }
  if (!followRedirect(data)) await navigateTo('/')
}
</script>

<template>
  <UCard :ui="{ body: 'p-6 sm:p-6' }">
    <div class="flex flex-col gap-3">
      <span class="size-10 rounded-lg flex items-center justify-center bg-(--ui-bg-elevated)" aria-hidden="true">
        <UIcon name="i-lucide-plug" class="size-5" />
      </span>
      <h1 class="text-xl font-semibold tracking-tight">
        Allow {{ clientName }}?
      </h1>
      <p class="text-sm text-(--ui-text-muted)">
        {{ clientName }} will act as you in this ticketing system, with exactly your rights.
      </p>
      <p v-if="scopes.length" class="text-xs text-(--ui-text-dimmed)">
        Scopes: {{ scopes.join(', ') }}
      </p>
    </div>
    <div class="mt-6 flex gap-2">
      <UButton size="lg" :loading="busy" class="flex-1 justify-center" @click="answer(true)">
        Allow
      </UButton>
      <UButton size="lg" variant="outline" :disabled="busy" class="flex-1 justify-center" @click="answer(false)">
        Deny
      </UButton>
    </div>
    <UAlert v-if="error" class="mt-4" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />
  </UCard>
</template>
