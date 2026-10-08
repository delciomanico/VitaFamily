// Parâmetros de rota (`req.params`) — Express tipa-os como `string | undefined` mesmo quando o
// contrato (openapi.yaml) os declara obrigatórios; `express-openapi-validator` já garante a
// presença antes de o handler correr (rota não bate = 404 do próprio validador), por isso aqui só
// se estreita o tipo para TypeScript, sem `!`/`as` (proibidos por `strictTypeChecked`,
// eslint.config.js) — lança (nunca deveria, é defensivo) em vez de assumir.
import type { Request } from "express";

export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined) {
    throw new Error(`Parâmetro de rota "${name}" em falta (contrato openapi.yaml).`);
  }
  return value;
}
