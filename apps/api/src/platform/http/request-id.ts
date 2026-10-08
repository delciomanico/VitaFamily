// Atribui um id a cada pedido (aceita um id de entrada válido, senão gera um novo), disponível a
// toda a cadeia de middlewares/handlers e devolvido ao cliente (equivalente a httpx.RequestID).
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const REQUEST_ID_HEADER = "X-Request-Id";
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmentação padrão dos tipos do Express.
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const id = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
