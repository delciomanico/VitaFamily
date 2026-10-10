// openapi.yaml `addPrescriptionMedication`: "Autorização: WRITE(MEDICATION)." UC-RX-05: acrescentar
// medicamento (plano) a uma receita existente — chama `medications.createPlan` (modules.md §3.6).
import type { CreateMedicationPlanInput, MedicationPlan } from "../../medications/index.js";
import { NotFoundError } from "../../../platform/errors/index.js";
import type { ActorIdentity, PrescriptionsDeps, RequestContext } from "./ports.js";

export function createAddPrescriptionMedicationUseCase<Trx>(deps: PrescriptionsDeps<Trx>) {
  return async function addPrescriptionMedication(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    prescriptionId: string,
    input: CreateMedicationPlanInput,
    context: RequestContext,
  ): Promise<MedicationPlan> {
    return deps.withTransaction(async (trx) => {
      // WRITE(MEDICATION) decidido aqui; `medications.createPlan` volta a decidir por si (é também
      // chamado diretamente pelo seu próprio router) — redundante mas inofensivo (authorization.md
      // §5.1: toda rota de negócio chama a policy).
      await deps.policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "UPDATE",
        subjectMemberId: memberId,
        category: "MEDICATION",
      });

      const prescription = await deps.prescriptionsRepo.findById(trx, familyId, memberId, prescriptionId);
      if (!prescription) {
        throw new NotFoundError({ detail: "Receita não encontrada." });
      }

      return deps.medications.createPlan(trx, actor, familyId, memberId, input, context, { prescriptionId });
    });
  };
}
