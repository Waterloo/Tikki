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
  },
})
