// Operações do contrato MK4 (commit 07364d5: partilha de registos e receita digital) ainda sem implementação. Os testes de conformidade/inventário
// de MK1/MK2/MK3 excluem-nas explicitamente; a fatia de QA do MK4 esvazia esta lista (ao ser vazia, as garantias voltam a cobrir tudo).
export const MK4_PENDING_OPERATION_IDS: ReadonlySet<string> = new Set([
  "createRecordShare", "getProfessionalBookingPrescription", "getProfessionalShare", "getRecordShare", "getRecordShareOptions",
  "issueProfessionalPrescription", "listProfessionalShares", "listRecordShareViews", "listRecordShares", "openProfessionalShare", "revokeRecordShare",
]);
