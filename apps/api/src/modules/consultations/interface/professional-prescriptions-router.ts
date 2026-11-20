// Rotas da receita digital do profissional (UC-MKT-59/60; tag «Professional Portal»). SÓ se montam com `DIGITAL_PRESCRIPTION_ENABLED` (BR-MKT-79):
// desligada, o pedido cai no 404 geral, indistinguível de rota inexistente. Privacidade (BR-MKT-81): `no-store`; corpo (medicamentos, observações)
// nunca em logs.
import { Router, type Request } from "express";
import { getProfessionalActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { PrescriptionMedicationInput, ProfessionalActor } from "../application/ports.js";
import type { ProfessionalPrescriptions } from "../application/professional-prescriptions.js";
import { body } from "./http-helpers.js";

function requireProfessional(): ProfessionalActor {
  const actor = getProfessionalActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { professionalId: actor.professionalId, professionalAccountId: actor.professionalAccountId };
}

const BASE = "/professional-portal/bookings";

export function createProfessionalPrescriptionsRouter(useCases: ProfessionalPrescriptions): Router {
  const router = Router();
  const id = (req: Request) => requireParam(req, "bookingId");

  router.post(
    `${BASE}/:bookingId/prescriptions`,
    asyncHandler(async (req, res) => {
      const payload = body(req);
      const notes = typeof payload.notes === "string" ? payload.notes : undefined;
      const view = await useCases.issue(requireProfessional(), id(req), { ...(notes !== undefined ? { notes } : {}), medications: payload.medications as PrescriptionMedicationInput[] }, buildRequestContext(req));
      res.status(201).set("Cache-Control", "no-store").json(view);
    }),
  );

  router.get(
    `${BASE}/:bookingId/prescription`,
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.get(requireProfessional(), id(req)));
    }),
  );

  return router;
}
