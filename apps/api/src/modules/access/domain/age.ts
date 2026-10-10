// Idade adulta (M7, modules.md §3 nota 11): duplica o pequeno cálculo de
// `families/domain/member.ts` (`MIN_ADULT_AGE`/`ageInYears`/`isMinor`) porque `access` não pode
// importar o `domain` de `families` (conventions.md §1: só pela raiz) — mesmo critério de
// duplicação de pequenos utilitários de idade já usado em `auth`/`users`/`families` entre si.
// Puro, sem I/O.
const MIN_ADULT_AGE = 18;

/** `birthDate` não implica menos de `MIN_ADULT_AGE` anos completos em `now` (UTC). */
export function isAdultAt(birthDate: string, now: Date): boolean {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const nowMonthDay = now.getUTCMonth() * 100 + now.getUTCDate();
  const birthMonthDay = birth.getUTCMonth() * 100 + birth.getUTCDate();
  if (nowMonthDay < birthMonthDay) {
    age -= 1;
  }
  return age >= MIN_ADULT_AGE;
}
