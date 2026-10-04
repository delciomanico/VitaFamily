/** “1 ano”, “39 anos”. */
export function formatAge(years: number): string {
  return years === 1 ? '1 ano' : `${years} anos`
}

/** “1 membro”, “4 membros”. */
export function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}
