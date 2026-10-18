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

interface ActorLike {
  kind: string
  name?: string | null
  email?: string | null
  contact?: Named
  application?: { name: string }
}

/** The person to show for an actor: a Contact by its name, an Application by its name, staff seen by an Application as "Support". */
export function actorPerson(actor: ActorLike): Named {
  if (actor.kind === 'contact') return actor.contact!
  if (actor.kind === 'application') return { name: actor.application!.name }
  return actor.kind === 'support' ? { name: 'Support' } : actor
}

/** "Contact · Acme Shop" for an Application's action for its Contact, else empty. An Application itself shows "via API". */
export function actorSource(actor: ActorLike): string {
  return actor.kind === 'contact' ? `Contact · ${actor.application!.name}` : ''
}
