<script setup lang="ts">
import type { Visibility } from '~/utils/visibility'

const model = defineModel<Visibility>({ required: true })
defineProps<{ id: string }>()
</script>

<template>
  <fieldset class="flex flex-col gap-2 min-w-0">
    <legend :id="`${id}-legend`" class="text-sm font-medium text-(--ui-text-highlighted) mb-2">
      Who sees these tickets
    </legend>
    <URadioGroup v-model="model" :items="VISIBILITIES" :aria-labelledby="`${id}-legend`" :ui="{ fieldset: 'gap-3', description: 'text-[13px] text-(--ui-text-muted)' }" />
  </fieldset>
</template>
