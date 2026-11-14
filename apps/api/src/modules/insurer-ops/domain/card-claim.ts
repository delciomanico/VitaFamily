// Reclamar o cartão (BR-SEG-20/25, openapi `InsuranceCardClaimRequest`). Regras puras: só o formato do pedido; a recusa por
// apólice/código inexistente, errado, expirado ou já ligado é sempre a mesma (anti-enumeração) e decide-se na application.
import { fail, requireText } from "./validation.js";

export interface ClaimRequest {
  insurerId: string;
  policyNumber: string;
  code: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseClaimRequest(input: { insurerId?: unknown; policyNumber?: unknown; code?: unknown }): ClaimRequest {
  if (typeof input.insurerId !== "string" || !UUID.test(input.insurerId)) fail("insurerId", "identificador inválido");
  return {
    insurerId: input.insurerId.toLowerCase(),
    policyNumber: requireText(input.policyNumber, "policyNumber", 60),
    code: requireText(input.code, "code", 40),
  };
}
