/** Data local de hoje em ISO (yyyy-mm-dd). */
export function todayISO(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** Idade em anos completos numa data (por defeito, hoje). */
export function ageOn(birthDate: string, now: Date = new Date()): number {
  const [year = 0, month = 1, day = 1] = birthDate.split('-').map(Number)
  let age = now.getFullYear() - year
  const beforeBirthday = now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)
  if (beforeBirthday) age -= 1
  return age
}

export function isValidISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** Hora local HH:mm de um instante ISO. */
export function localTime(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Data ISO (yyyy-mm-dd) `months` meses antes de `date`. */
export function monthsBefore(date: string, months: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  return todayISO(new Date(year, month - 1 - months, day))
}
