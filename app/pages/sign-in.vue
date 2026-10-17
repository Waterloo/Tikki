<script setup lang="ts">
const email = ref('')
const otp = ref('')
const step = ref<'email' | 'code'>('email')
const error = ref<string | null>(null)
const busy = ref(false)

async function sendCode() {
  busy.value = true
  error.value = null
  const { error: err } = await authClient.emailOtp.sendVerificationOtp({ email: email.value.trim(), type: 'sign-in' })
  busy.value = false
  if (err) {
    error.value = err.message ?? 'The code could not be sent.'
    return
  }
  step.value = 'code'
}

async function signIn() {
  busy.value = true
  error.value = null
  const { data, error: err } = await authClient.signIn.emailOtp({ email: email.value.trim(), otp: otp.value.trim() })
  busy.value = false
  if (err) {
    error.value = err.message ?? 'The code is not correct.'
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
          Sign in
        </h1>
      </template>

      <form v-if="step === 'email'" class="space-y-4" @submit.prevent="sendCode">
        <UFormField label="Work email">
          <UInput v-model="email" type="email" autocomplete="email" required autofocus class="w-full" />
        </UFormField>
        <UButton type="submit" block :loading="busy">
          Send code
        </UButton>
      </form>

      <form v-else class="space-y-4" @submit.prevent="signIn">
        <p class="text-sm text-(--ui-text-muted)">
          We sent a code to {{ email }}. Type it here.
        </p>
        <UFormField label="Code">
          <UInput v-model="otp" inputmode="numeric" autocomplete="one-time-code" required autofocus class="w-full" />
        </UFormField>
        <UButton type="submit" block :loading="busy">
          Sign in
        </UButton>
        <UButton variant="link" size="sm" @click="step = 'email'; otp = ''">
          Use another email
        </UButton>
      </form>

      <UAlert v-if="error" class="mt-4" color="error" variant="subtle" :description="error" />
    </UCard>
  </div>
</template>
