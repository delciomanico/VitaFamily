// API pública para `appointments`/`examinations` (modules.md §2: ambos dependem de `clinics`,
// `ClinicLookup`) — resolve o nome atual de uma clínica selecionável numa nova marcação
// (BR-APT-04/BR-CLN-01/`state-machines.md` Clinic: "Arquivada: não selecionável em novas
// marcações"). Devolve `null` se a clínica não existe, está ARCHIVED, ou (sendo PRIVATE) não é da
// família do pedido — quem chama decide o erro (ValidationError no campo `clinicId`, não
// NotFoundError: a consulta/exame em si existe, só a referência é que é inválida). Sem
// autorização própria (quem chama já autorizou a escrita no recurso de saúde antes).
import type { ClinicsDeps } from "./ports.js";

export interface BookableClinic {
  id: string;
  name: string;
}

export function createGetBookableClinicUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function getBookableClinic(trx: Trx, familyId: string, clinicId: string): Promise<BookableClinic | null> {
    const clinic = await deps.clinicsRepo.findById(trx, clinicId);
    if (!clinic) {
      return null;
    }
    if (clinic.status !== "ACTIVE") {
      return null;
    }
    if (clinic.type === "PRIVATE" && clinic.familyId !== familyId) {
      return null;
    }
    return { id: clinic.id, name: clinic.name };
  };
}
