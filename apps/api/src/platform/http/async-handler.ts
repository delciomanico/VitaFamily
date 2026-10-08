// Express 4 não encaminha rejeições de handlers assíncronos para o middleware de erro; este
// wrapper trata-o (equivalente ao que o Express 5/outras libs fazem por defeito).
import type { NextFunction, Request, Response } from "express";

export type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

export function asyncHandler(handler: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
