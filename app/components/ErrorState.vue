<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <UAlert
    color="error"
    variant="subtle"
    icon="i-lucide-circle-alert"
    :title="title"
    :description="description"
    :actions="[{ label: 'Try again', color: 'error', variant: 'solid', size: 'xs', onClick: () => $emit('retry') }]"
  />
</template>
