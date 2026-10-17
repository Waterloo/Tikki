<script setup lang="ts">
export interface Field {
  key: string
  label: string
  type: 'short_text' | 'long_text' | 'number' | 'date' | 'single_select' | 'multi_select' | 'checkbox' | 'user' | 'url' | 'file'
  required: boolean
  help: string
  options?: string[]
}

defineProps<{ field: Field }>()
// Each input sets the value type of its own Field; the Field validator on the server checks it.
const value = defineModel<any>()
</script>

<template>
  <UTextarea v-if="field.type === 'long_text'" v-model="value" :rows="3" class="w-full" />
  <UInput v-else-if="field.type === 'number'" v-model.number="value" type="number" class="w-full" />
  <UInput v-else-if="field.type === 'date'" v-model="value" type="date" class="w-full" />
  <UInput v-else-if="field.type === 'url'" v-model="value" type="url" placeholder="https://" class="w-full" />
  <USelect v-else-if="field.type === 'single_select'" v-model="value" :items="field.options ?? []" placeholder="Choose one" class="w-full" />
  <UCheckboxGroup v-else-if="field.type === 'multi_select'" v-model="value" :items="field.options ?? []" />
  <UCheckbox v-else-if="field.type === 'checkbox'" v-model="value" :label="field.label" />
  <!-- User and file Fields take an ID, until People (issue 20) and Attachments (issue 16) give pickers. -->
  <UInput v-else-if="field.type === 'user'" v-model="value" placeholder="User ID" class="w-full" />
  <UInput v-else-if="field.type === 'file'" v-model="value" placeholder="File reference" class="w-full" />
  <UInput v-else v-model="value" class="w-full" />
</template>
