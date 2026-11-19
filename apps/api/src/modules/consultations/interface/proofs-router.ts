// Controllers HTTP dos comprovativos (família: tag «Bookings»; profissional: «Professional Portal»; UC-MKT-35/36). `multipart` em `req.files`
// (multer, ligado pela validação do openapi); sem corpo, nome de ficheiro nem query em logs (BR-MKT-63). Downloads: `private, no-store`,
// `attachment`, `nosniff`.
import { Router, type Request, type Response } from "express";
import { getProfessionalActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError, ValidationError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { ProfessionalActor } from "../application/ports.js";
import type { ProofDownload } from "../application/proofs.js";
import type { createFamilyProofs, createProfessionalProofs } from "../application/proofs.js";
import { body, optionalString, requireActor } from "./http-helpers.js";

function requireProfessional(): ProfessionalActor {
  const actor = getProfessionalActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { professionalId: actor.professionalId, professionalAccountId: actor.professionalAccountId };
}

/** Forma mínima do ficheiro do multer (a `interface` não depende dos tipos do multer). */
interface UploadedFile {
  fieldname: string;
  buffer: Buffer;
}

function requireUploadedFile(req: { files?: unknown }): UploadedFile {
  const files = Array.isArray(req.files) ? (req.files as UploadedFile[]) : [];
  const file = files.find((f) => f.fieldname === "file");
  if (!file) throw new ValidationError([{ field: "file", message: "obrigatório" }], { detail: "Ficheiro obrigatório." });
  return file;
}

export function sendProof(res: Response, download: ProofDownload): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", download.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="comprovativo.${download.extension}"`);
  download.stream.on("error", () => res.destroy());
  download.stream.pipe(res);
}

const FAMILY_BASE = "/families/:familyId/members/:memberId/bookings/:bookingId/payment-proofs";

export function createFamilyProofsRouter(useCases: ReturnType<typeof createFamilyProofs>): Router {
  const router = Router();
  const ids = (req: Request) => ({ familyId: requireParam(req, "familyId"), memberId: requireParam(req, "memberId"), bookingId: requireParam(req, "bookingId") });

  router.get(
    FAMILY_BASE,
    asyncHandler(async (req, res) => {
      const { familyId, memberId, bookingId } = ids(req);
      res.set("Cache-Control", "no-store").json(await useCases.listProofs(requireActor(), familyId, memberId, bookingId));
    }),
  );

  router.post(
    FAMILY_BASE,
    asyncHandler(async (req, res) => {
      const { familyId, memberId, bookingId } = ids(req);
      const file = requireUploadedFile(req);
      const proof = await useCases.uploadProof(requireActor(), familyId, memberId, bookingId, { buffer: file.buffer }, buildRequestContext(req));
      res.status(201).set("Cache-Control", "no-store").json(proof);
    }),
  );

  router.get(
    `${FAMILY_BASE}/:proofId/file`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId, bookingId } = ids(req);
      sendProof(res, await useCases.downloadProof(requireActor(), familyId, memberId, bookingId, requireParam(req, "proofId"), buildRequestContext(req)));
    }),
  );

  return router;
}

export function createProfessionalProofsRouter(useCases: ReturnType<typeof createProfessionalProofs>): Router {
  const router = Router();
  const BASE = "/professional-portal/bookings/:bookingId/payment-proofs/:proofId";

  router.get(
    `${BASE}/file`,
    asyncHandler(async (req, res) => {
      sendProof(res, await useCases.downloadProof(requireProfessional(), requireParam(req, "bookingId"), requireParam(req, "proofId"), buildRequestContext(req)));
    }),
  );

  router.post(
    `${BASE}/decision`,
    asyncHandler(async (req, res) => {
      const payload = body(req);
      const decision = payload.decision === "CONFIRM" || payload.decision === "REJECT" ? payload.decision : undefined;
      if (!decision) throw new ValidationError([{ field: "decision", message: "CONFIRM ou REJECT" }], { detail: "Dados inválidos." });
      const reason = optionalString(payload.reason);
      const proof = await useCases.decideProof(requireProfessional(), requireParam(req, "bookingId"), requireParam(req, "proofId"), { decision, ...(reason !== undefined ? { reason } : {}) }, buildRequestContext(req));
      res.set("Cache-Control", "no-store").json(proof);
    }),
  );

  return router;
}
