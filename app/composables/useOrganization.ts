/** The organization shown in the app shell. Fixed until the Settings page exists (issue 21). */
export function useOrganization() {
  const name = 'Ticketing'
  return {
    name,
    subtitle: 'Support desk',
    initial: name.charAt(0).toUpperCase(),
  }
}
