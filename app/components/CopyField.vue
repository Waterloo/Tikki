<script setup lang="ts">
const props = defineProps<{ value: string, label: string }>()

const copied = ref(false)
const failed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  failed.value = false
  try {
    await navigator.clipboard.writeText(props.value)
    copied.value = true
  } catch {
    // No clipboard access (an http page, or a refused permission). The text stays selectable.
    failed.value = true
  }
  clearTimeout(timer)
  timer = setTimeout(() => (copied.value = false), 2000)
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="flex flex-col gap-1.5 min-w-0">
    <div class="flex items-center gap-2 min-w-0">
      <code :aria-label="label" class="flex-1 min-w-0 truncate select-all rounded-lg border border-(--ui-border) bg-(--ui-bg-muted) px-3 py-2 font-mono text-[13px] text-(--ui-text-highlighted)">{{ value }}</code>
      <UButton :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="outline" size="lg" :aria-label="`Copy ${label}`" @click="copy">
        {{ copied ? 'Copied' : 'Copy' }}
      </UButton>
    </div>
    <p v-if="failed" role="alert" class="text-xs text-(--ui-error)">
      Your browser blocked copying. Select the text and copy it by hand.
    </p>
  </div>
</template>
