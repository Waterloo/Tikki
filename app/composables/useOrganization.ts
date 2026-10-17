export interface Organization {
  name: string
  subtitle: string
  logo_url: string | null
}

const state = () => useState<Organization>('organization', () => ({ name: 'Ticketing', subtitle: '', logo_url: null }))

/** The stored name, subtitle and logo. The `organization` plugin loads them before the app shows. */
export function useOrganization() {
  const org = state()
  return computed(() => ({
    name: org.value.name,
    subtitle: org.value.subtitle,
    logoUrl: org.value.logo_url,
    initial: org.value.name.trim().charAt(0).toUpperCase() || '?',
  }))
}

export function setOrganization(value: Organization) {
  state().value = value
}

export async function refreshOrganization() {
  setOrganization(await $fetch<Organization>('/api/v1/organization'))
}
