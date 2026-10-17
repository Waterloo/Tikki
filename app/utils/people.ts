interface Named {
  name?: string | null
  email?: string | null
}

/** Sign-in by email code gives no name, so the email stands in. */
export function displayName(person: Named): string {
  return person.name?.trim() || person.email || ''
}

export function initials(person: Named): string {
  const source = person.name?.trim() || person.email?.split('@')[0] || ''
  return source.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('')
}
