<script setup lang="ts">
import type { Attachment } from '~/types/tickets'

// The model is the ID of the upload. It is set only when the upload is done.
const model = defineModel<string | undefined>()
const uploading = defineModel<boolean>('uploading', { default: false })

const { id: inputId } = useFormField()
const file = ref<Attachment | null>(null)
const error = ref<string | null>(null)
const over = ref(false)

async function upload(picked: File | undefined) {
  if (!picked || uploading.value) return
  error.value = null
  uploading.value = true
  try {
    file.value = await uploadFile(picked)
    model.value = file.value.id
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    uploading.value = false
  }
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  upload(input.files?.[0])
  // The same file can be picked again after Remove.
  input.value = ''
}

function onDrop(event: DragEvent) {
  over.value = false
  upload(event.dataTransfer?.files[0])
}

function remove() {
  file.value = null
  model.value = undefined
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div v-if="file && !uploading" class="flex flex-wrap items-center gap-2">
      <AttachmentChip :attachment="file" />
      <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-x" :aria-label="`Remove ${file.filename}`" @click="remove" />
    </div>
    <label
      v-else
      class="relative flex w-full items-center justify-center gap-2 min-h-[72px] rounded-[10px] border border-dashed px-3 text-center text-sm text-(--ui-text-toned) cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-(--ui-primary)"
      :class="over ? 'border-(--ui-primary) bg-(--app-row-hover)' : 'border-(--ui-border-accented) bg-(--ui-bg-muted)'"
      @dragover.prevent="over = true"
      @dragleave="over = false"
      @drop.prevent="onDrop"
    >
      <UIcon :name="uploading ? 'i-lucide-loader-circle' : 'i-lucide-upload'" class="size-4 shrink-0" :class="uploading ? 'animate-spin' : ''" aria-hidden="true" />
      <span v-if="uploading" role="status">Uploading…</span>
      <span v-else>Drop a file or click to choose · up to 25 MB</span>
      <input :id="inputId" type="file" class="absolute inset-0 size-full opacity-0 cursor-pointer" :disabled="uploading" @change="onPick">
    </label>
    <p v-if="error" class="text-sm text-(--ui-error)" role="alert">
      {{ error }}
    </p>
  </div>
</template>
