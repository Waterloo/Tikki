<script setup lang="ts">
defineProps<{ value: string }>()
</script>

<template>
  <span class="font-mono text-[13px] text-(--ui-text-muted) whitespace-nowrap">{{ value }}</span>
</template>
