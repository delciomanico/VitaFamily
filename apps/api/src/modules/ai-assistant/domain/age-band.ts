// Faixa etária (BR-AI-10): nunca a idade exata nem a data de nascimento. Puro.
export type AgeBand = "0-2" | "3-12" | "13-17" | "18-39" | "40-64" | "65+";

/** Idade em anos completos a `now` (UTC; a faixa é grosseira, o fuso não muda a faixa de forma relevante). */
export function ageInYears(birthDate: string, now: Date): number {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return Math.max(0, age);
}

export function ageBandOf(birthDate: string, now: Date): AgeBand {
  const age = ageInYears(birthDate, now);
  if (age <= 2) return "0-2";
  if (age <= 12) return "3-12";
  if (age <= 17) return "13-17";
  if (age <= 39) return "18-39";
  if (age <= 64) return "40-64";
  return "65+";
}

export const isAdult = (birthDate: string, now: Date): boolean => ageInYears(birthDate, now) >= 18;
