<script setup lang="ts">
definePageMeta({ layout: 'auth' })

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

function useAnotherEmail() {
  step.value = 'email'
  otp.value = ''
  error.value = null
}
</script>

<template>
  <UCard :ui="{ body: 'p-6 sm:p-6' }">
    <div class="flex flex-col gap-1 mb-6">
      <h1 class="text-xl font-semibold tracking-tight">
        Sign in
      </h1>
      <p class="text-sm text-(--ui-text-muted)">
        {{ step === 'email' ? 'We send a one-time code to your work email.' : `We sent a code to ${email}.` }}
      </p>
    </div>

    <form v-if="step === 'email'" class="flex flex-col gap-4" @submit.prevent="sendCode">
      <UFormField label="Work email">
        <UInput v-model="email" type="email" autocomplete="email" required autofocus size="lg" class="w-full" />
      </UFormField>
      <UButton type="submit" block size="lg" :loading="busy">
        Send code
      </UButton>
    </form>

    <form v-else class="flex flex-col gap-4" @submit.prevent="signIn">
      <UFormField label="Code" help="It expires in 10 minutes.">
        <UInput v-model="otp" inputmode="numeric" autocomplete="one-time-code" required autofocus size="lg" class="w-full font-mono tracking-widest" />
      </UFormField>
      <UButton type="submit" block size="lg" :loading="busy">
        Sign in
      </UButton>
      <UButton variant="link" color="primary" size="sm" class="self-start px-0" @click="useAnotherEmail">
        Use another email
      </UButton>
    </form>

    <UAlert v-if="error" class="mt-4" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />
  </UCard>
</template>
