// Guarda de `Content-Length` do upload de comprovativos (família). O multer do validador OpenAPI corre ANTES das rotas e guarda o
// ficheiro em memória; esta guarda recusa, sem ler o corpo, pedidos que excedam o teto (1 ficheiro × UPLOAD_MAX_BYTES + folga de
// cabeçalhos multipart) ou sem `Content-Length` válido. Monta-se à frente da app (composition root), só para `POST .../payment-proofs`.
// Erros do contrato: 413 FILE_TOO_LARGE; ausente/inválido ⇒ 422 VALIDATION_ERROR (o openapi não declara 400/411 nesta operação).
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { DomainError, ValidationError, toProblem } from "../../../platform/errors/index.js";

/** Folga para fronteiras, cabeçalhos de parte e campos multipart (o contrato só tem o campo `file`). */
export const PROOF_UPLOAD_OVERHEAD_BYTES = 64 * 1024;

const PROOF_UPLOAD_PATH = /^\/api\/v1\/families\/[^/]+\/members\/[^/]+\/bookings\/[^/]+\/payment-proofs\/?$/;

export function createProofUploadGuard(options: { maxFileBytes: number }): RequestHandler {
  const ceiling = options.maxFileBytes + PROOF_UPLOAD_OVERHEAD_BYTES;
  return (req, res, next) => {
    if (req.method !== "POST" || !PROOF_UPLOAD_PATH.test(req.path)) {
      next();
      return;
    }
    const raw = req.headers["content-length"];
    const length = typeof raw === "string" && /^\d{1,15}$/.test(raw) ? Number(raw) : undefined;
    let error: DomainError | undefined;
    if (length === undefined) {
      error = new ValidationError([{ field: "Content-Length", message: "obrigatório e numérico" }], { detail: "Content-Length em falta ou inválido." });
    } else if (length > ceiling) {
      error = new DomainError("FILE_TOO_LARGE", { detail: "Ficheiro acima do limite permitido." });
    }
    if (!error) {
      next();
      return;
    }
    const requestId = randomUUID();
    const { status, body } = toProblem(error, requestId);
    res.setHeader("X-Request-Id", requestId);
    // Fecha a ligação: o corpo não vai ser lido.
    res.setHeader("Connection", "close");
    res.status(status).type("application/problem+json").json(body);
  };
}
