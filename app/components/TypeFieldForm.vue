<script setup lang="ts">
import { keyFromLabel, RESERVED_FIELD_KEYS } from '~~/shared/ticket-type-rules'
import type { FieldDef, FieldType } from '~/types/ticket-types'

const props = defineProps<{
  /** Keys of the Fields the type has, archived ones too. */
  takenKeys: readonly string[]
  /** What locks the key, for the line under the label: "when you create the type". */
  lockNote: string
}>()
const emit = defineEmits<{ add: [field: FieldDef], cancel: [] }>()

const label = ref('')
const type = ref<FieldType>('short_text')
const optionsText = ref('')
const help = ref('')
const required = ref(false)

const key = computed(() => keyFromLabel(label.value))
const options = computed(() => [...new Set(optionsText.value.split('\n').map(o => o.trim()).filter(Boolean))])
const select = computed(() => isSelectType(type.value))

const keyProblem = computed(() => {
  if (!key.value) return null
  if (props.takenKeys.includes(key.value)) return `Key ${key.value} is already used. Change the label.`
  if (RESERVED_FIELD_KEYS.includes(key.value)) return `Key ${key.value} is reserved for a core attribute of a ticket. Change the label.`
  return null
})
const keyLine = computed(() => keyProblem.value ?? (key.value ? `Key: ${key.value} · it locks ${props.lockNote}` : 'Type a label. The key is made from it.'))
const canAdd = computed(() => key.value !== '' && !keyProblem.value && (!select.value || options.value.length > 0))

function add() {
  if (!canAdd.value) return
  emit('add', {
    key: key.value,
    label: label.value.trim(),
    type: type.value,
    required: required.value,
    help: help.value.trim(),
    ...(select.value ? { options: options.value.map(value => ({ value })) } : {}),
  })
}
</script>

<template>
  <form class="p-4 rounded-xl border border-[#c9d7f2] bg-[#f7fafe] dark:border-[#2a3a5c] dark:bg-[#141b2b] flex flex-col gap-3.5" novalidate @submit.prevent="add" @keydown.esc="emit('cancel')">
    <div class="grid gap-3.5 sm:grid-cols-2">
      <UFormField label="Label" name="label">
        <UInput v-model="label" autofocus placeholder="For example: Needed until" class="w-full" />
        <p class="mt-1.5 text-[13px] break-all" :class="keyProblem ? 'text-(--ui-error)' : 'text-(--ui-text-muted)'" :role="keyProblem ? 'alert' : undefined">
          {{ keyLine }}
        </p>
      </UFormField>
      <UFormField label="Data type" name="type">
        <USelect v-model="type" :items="FIELD_TYPE_OPTIONS" class="w-full" />
      </UFormField>
    </div>
    <UFormField v-if="select" label="Options, one on each line" name="options">
      <UTextarea v-model="optionsText" :rows="3" class="w-full" />
    </UFormField>
    <UFormField label="Help text" name="help" description="Shown under the field. Claude uses it to ask the question.">
      <UInput v-model="help" placeholder="Explain what to enter" class="w-full" />
    </UFormField>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <UCheckbox v-model="required" label="Required" />
      <div class="flex gap-2">
        <UButton type="button" variant="outline" size="lg" @click="emit('cancel')">
          Cancel
        </UButton>
        <UButton type="submit" size="lg" :disabled="!canAdd">
          Add field
        </UButton>
      </div>
    </div>
  </form>
</template>
