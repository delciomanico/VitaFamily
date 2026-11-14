/** Dados institucionais do site público. Única fonte: alterar aqui (ou por variável de ambiente). */
export const site = {
  name: 'Vita Family',
  /** Entidade responsável pelo tratamento (docs/08-security/privacy.md §1). */
  operator: 'Cassfrei',
  url: 'https://vitafamily.cassfrei.com',
  /** A confirmar pelo proprietário: contacto de apoio e de pedidos de acesso. */
  contactEmail: (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ?? 'geral@cassfrei.com',
} as const

export function mailto(subject: string, body: string): string {
  return `mailto:${site.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
