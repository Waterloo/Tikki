export default defineAppConfig({
  ui: {
    colors: {
      primary: 'blue',
      neutral: 'zinc',
    },
    // Main actions are dark, as on the design canvas. Blue stays for links, focus and selection.
    button: {
      defaultVariants: { color: 'neutral' },
    },
    // Form controls are 44 px high with 10 px corners on the canvas.
    input: {
      slots: { base: 'min-h-11 rounded-[10px]' },
      defaultVariants: { size: 'lg' },
    },
    textarea: {
      slots: { base: 'rounded-[10px]' },
      defaultVariants: { size: 'lg' },
    },
    select: {
      slots: { base: 'min-h-11 rounded-[10px]' },
      defaultVariants: { size: 'lg' },
    },
    formField: {
      slots: { label: 'text-(--ui-text-highlighted)', description: 'text-[13px]' },
    },
  },
})
