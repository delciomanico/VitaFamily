// Comprimento em PONTOS DE CÓDIGO (como `char_length` do PostgreSQL e o `maxLength` do OpenAPI), não em unidades UTF-16 (`.length`):
// um emoji conta 1, não 2. Evita recusar texto válido e, ao contrário, aceitar texto que a BD recusaria.
export function charLength(value: string): number {
  return Array.from(value).length;
}
