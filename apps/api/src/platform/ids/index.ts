// Identificadores (UUID v4) para entidades e pedidos. Nunca gerar IDs sequenciais/previsíveis.
import { randomUUID } from "node:crypto";

/** Devolve um novo UUID v4. */
export function newId(): string {
  return randomUUID();
}
