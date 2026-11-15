// Código de autorização (BR-SEG-05): ≥ 128 bits de entropia, não adivinhável. `node:crypto` chama-se diretamente do domínio
// (conventions.md §3.2). 28 caracteres de um alfabeto de 31 (sem 0/O/1/I/L) ≈ 138 bits, em 7 grupos de 4 para ditar por telefone.
import { randomInt } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const GROUPS = 7;
const GROUP_SIZE = 4;

export function generateAuthorizationCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = "";
    for (let i = 0; i < GROUP_SIZE; i++) group += ALPHABET.charAt(randomInt(ALPHABET.length));
    groups.push(group);
  }
  return groups.join("-");
}
