// Lista local de palavras-passe comuns/vazadas (authentication.md §1: "rejeitar palavras-passe
// comuns/vazadas (lista local)"). Amostra representativa das mais frequentes em listas públicas de
// senhas vazadas (ex.: "RockYou"), com pelo menos 12 caracteres (as únicas que passariam a regra
// de comprimento mínimo — senhas mais curtas já são rejeitadas por `PASSWORD_MIN_LENGTH`).
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  [
    "password123",
    "password1234",
    "iloveyou123",
    "123456789012",
    "qwertyuiop12",
    "letmein12345",
    "admin1234567",
    "welcome12345",
    "sunshine1234",
    "princess1234",
    "football1234",
    "baseball1234",
    "dragon123456",
    "monkey123456",
    "trustno1admin",
    "superman1234",
    "batman123456",
    "123456abcdef",
    "abcdefghijkl",
    "qwertyasdfgh",
    "passw0rd1234",
    "p@ssw0rd1234",
    "changeme1234",
    "default12345",
    "welcome@2024",
    "password@123",
    "qwerty123456",
    "1q2w3e4r5t6y",
    "zaq12wsx3edc",
    "iloveyou1234",
  ].map((p) => p.toLowerCase()),
);

/** Verifica se `password` (normalizada em minúsculas) está na lista local. */
export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}
