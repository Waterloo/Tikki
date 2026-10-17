<script setup lang="ts">
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
  <div class="min-h-screen flex items-center justify-center p-4 bg-(--ui-bg-muted)">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-lg font-semibold">
          Allow access?
        </h1>
      </template>
      <p class="text-sm">
        <strong>{{ clientName }}</strong> wants to act as you in this ticketing system. It gets the same rights as you.
      </p>
      <p v-if="scopes.length" class="mt-2 text-xs text-(--ui-text-muted)">
        Scopes: {{ scopes.join(', ') }}
      </p>
      <div class="mt-4 flex gap-2">
        <UButton :loading="busy" @click="answer(true)">
          Allow
        </UButton>
        <UButton color="neutral" variant="outline" :disabled="busy" @click="answer(false)">
          Deny
        </UButton>
      </div>
      <UAlert v-if="error" class="mt-4" color="error" variant="subtle" :description="error" />
    </UCard>
  </div>
</template>
