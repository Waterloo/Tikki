<script setup lang="ts">
import type { DraftField } from '~/types/ticket-types'

// Edits the Field in place. The key and the data type are shown and cannot change (4.5).
const field = defineModel<DraftField>({ required: true })
defineProps<{ error?: string }>()
const emit = defineEmits<{ done: [] }>()

const newOption = ref('')
const optionProblem = computed(() => {
  const value = newOption.value.trim()
  return value && field.value.options?.some(o => o.value === value) ? 'This option exists.' : null
})

function addOption() {
  const value = newOption.value.trim()
  if (!value || optionProblem.value) return
  field.value.options = [...(field.value.options ?? []), { value }]
  newOption.value = ''
}

function toggleOption(value: string) {
  field.value.options = field.value.options?.map(o => o.value === value ? (o.archived ? { value } : { value, archived: true }) : o)
}
</script>

<template>
  <div class="flex flex-col gap-3.5 p-4 rounded-xl border border-[#c9d7f2] bg-[#f7fafe] dark:border-[#2a3a5c] dark:bg-[#141b2b]" @keydown.esc="emit('done')">
    <div class="grid gap-3.5 sm:grid-cols-2">
      <UFormField label="Label" :error="error">
        <UInput v-model="field.label" class="w-full" />
      </UFormField>
      <div class="flex flex-col gap-1.5">
        <span class="text-sm font-medium text-(--ui-text-highlighted)">Key and data type</span>
        <p class="flex flex-wrap items-center gap-2 min-h-11 text-sm text-(--ui-text-toned)">
          <UIcon name="i-lucide-lock" class="size-3.5 text-(--ui-text-muted)" aria-hidden="true" />
          <span class="font-mono text-[13px]">{{ field.key }}</span>
          <span>{{ fieldTypeLabel(field.type) }}</span>
        </p>
        <p class="text-[13px] text-(--ui-text-muted)">
          A key and its data type never change. To use another data type, archive this Field and add a new one.
        </p>
      </div>
    </div>

    <div v-if="isSelectType(field.type)" class="flex flex-col gap-2">
      <span class="text-sm font-medium text-(--ui-text-highlighted)">Options</span>
      <ul class="flex flex-col gap-1.5">
        <li v-for="o in field.options" :key="o.value" class="flex items-center gap-3 text-sm">
          <span class="[overflow-wrap:anywhere]" :class="o.archived ? 'text-(--ui-text-muted) line-through' : 'text-(--ui-text-highlighted)'">{{ o.value }}</span>
          <UButton
            type="button"
            size="xs"
            variant="outline"
            class="ml-auto"
            :aria-label="`${o.archived ? 'Restore' : 'Archive'} option ${o.value}`"
            @click="toggleOption(o.value)"
          >
            {{ o.archived ? 'Restore' : 'Archive' }}
          </UButton>
        </li>
      </ul>
      <div class="flex gap-2">
        <UInput v-model="newOption" placeholder="New option" aria-label="New option" class="flex-1" @keydown.enter.prevent="addOption" />
        <UButton type="button" variant="outline" size="lg" :disabled="!newOption.trim() || !!optionProblem" @click="addOption">
          Add option
        </UButton>
      </div>
      <p v-if="optionProblem" class="text-[13px] text-(--ui-error)">
        {{ optionProblem }}
      </p>
      <p class="text-[13px] text-(--ui-text-muted)">
        An option cannot be deleted, because old tickets use it. Archive it to hide it from new tickets.
      </p>
    </div>

    <UFormField label="Help text" description="Shown under the field. Claude uses it to ask the question.">
      <UInput v-model="field.help" class="w-full" />
    </UFormField>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <UCheckbox v-model="field.required" label="Required" description="For new tickets only. Old tickets keep their values." />
      <UButton type="button" size="lg" @click="emit('done')">
        Done
      </UButton>
    </div>
  </div>
</template>
