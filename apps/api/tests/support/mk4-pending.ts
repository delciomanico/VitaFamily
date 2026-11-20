// Operações do contrato MK4 (commit 07364d5: partilha de registos e receita digital) ainda sem implementação: **vazio** desde S9 (as 11 estão implementadas; mesmo padrão de `MK3_PENDING_OPERATION_IDS`).
export const MK4_PENDING_OPERATION_IDS: ReadonlySet<string> = new Set([]);

// Todas as operações do contrato MK4 (11, inventário completo): os testes de conformidade de MK1/MK2/MK3 deixam-nas de fora (têm os seus testes; a fatia S10
// de QA do MK4 cobre-as com `MK4_OPERATION_IDS` e esvazia as exclusões).
export const MK4_OPERATION_IDS: ReadonlySet<string> = new Set([
  "createRecordShare", "getProfessionalBookingPrescription", "getProfessionalShare", "getRecordShare", "getRecordShareOptions",
  "issueProfessionalPrescription", "listProfessionalShares", "listRecordShareViews", "listRecordShares", "openProfessionalShare", "revokeRecordShare",
]);
