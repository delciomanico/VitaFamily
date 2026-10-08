// Contexto comum de pedido (requestId/ip/userAgent) para auditoria (audit.md §1) — reutilizado por
// todos os módulos que escrevem `audit_logs` a partir de um controller HTTP.
import type { Request } from "express";

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

/** `exactOptionalPropertyTypes` exige omitir a chave (não `undefined`) quando o valor falta. */
export function buildRequestContext(req: Request): RequestContext {
  const context: RequestContext = { requestId: req.requestId };
  if (req.ip !== undefined) {
    context.ip = req.ip;
  }
  const userAgent = req.headers["user-agent"];
  if (typeof userAgent === "string") {
    context.userAgent = userAgent;
  }
  return context;
}
