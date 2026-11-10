// Evento de auditoria (audit.md §1/§3): tipo puro, sem I/O. `metadata` nunca contém dados de
// saúde nem segredos (audit.md regra 2) — responsabilidade de quem chama `record()`, não validada
// aqui em runtime (seria impossível distinguir em geral); documentado para os autores de chamadas.

/** Catálogo mínimo de ações (audit.md §3); outros módulos acrescentam as suas ao longo do plano. */
export type AuditAction =
  | "AUTH_LOGIN"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_LOGOUT"
  | "AUTH_REFRESH_REUSE_DETECTED"
  | "AUTH_PASSWORD_RESET"
  | "AUTH_PASSWORD_CHANGE"
  | "AUTH_EMAIL_VERIFIED"
  | "USER_UPDATE"
  | "USER_TERMS_ACCEPTED"
  | "USER_DELETE"
  | "USER_EXPORT_REQUEST"
  | "USER_EXPORT_DOWNLOAD"
  | "ACCESS_DENIED"
  // `families` (M2 — family.md/member.md):
  | "FAMILY_CREATE"
  | "FAMILY_UPDATE"
  | "FAMILY_DELETE"
  | "FAMILY_LEAVE"
  | "MEMBER_CREATE"
  | "MEMBER_UPDATE"
  | "MEMBER_REMOVE"
  | "MEMBER_ROLE_CHANGE"
  | "MEMBER_DEPENDENT_CHANGE"
  | "GUARDIAN_ADD"
  | "GUARDIAN_REMOVE"
  | "GUARDIAN_PRIMARY_CHANGE"
  | "INVITATION_CREATE"
  | "INVITATION_REVOKE"
  | "INVITATION_ACCEPT"
  | "DEPENDENT_ACCOUNT_INVITATION_CREATE"
  // `access` (M3 — authorization.md/UC-PRV, audit.md §3 "Partilha"):
  | "SHARING_UPDATE"
  // `health-records` (M4 — FR-HP, audit.md §3 "Dados de saúde"; `HEALTH_VIEW` cobre leitura por
  // quem não é o titular — tutor ou partilha, audit.md regra "não se audita a leitura do titular"):
  | "HEALTH_VIEW"
  | "ALLERGY_CREATE"
  | "ALLERGY_UPDATE"
  | "ALLERGY_DELETE"
  | "CONDITION_CREATE"
  | "CONDITION_UPDATE"
  | "CONDITION_DELETE"
  | "BLOODTYPE_UPDATE"
  // `documents` (M5 — FR-DOC/BR-DOC, audit.md §3; ADR-006/ADR-011):
  | "DOCUMENT_UPLOAD"
  | "DOCUMENT_SCAN_CLEAN"
  | "DOCUMENT_SCAN_INFECTED"
  | "DOCUMENT_DOWNLOAD"
  | "DOCUMENT_DELETE"
  // `prescriptions`/`medications` (M6 — FR-RX/FR-MED, audit.md §3: "PRESCRIPTION_*", "PLAN_*",
  // "DOSE_TAKEN"/"DOSE_NOT_TAKEN"/"DOSE_CORRECTED"):
  | "PRESCRIPTION_CREATE"
  | "PRESCRIPTION_UPDATE"
  | "PRESCRIPTION_DELETE"
  | "PRESCRIPTION_STATUS"
  | "PLAN_CREATE"
  | "PLAN_UPDATE"
  | "PLAN_DELETE"
  | "PLAN_STATUS"
  | "DOSE_TAKEN"
  | "DOSE_NOT_TAKEN"
  | "DOSE_CORRECTED"
  // `appointments`/`examinations`/`clinics` (M7 — FR-APT/FR-EXM/FR-CLN, audit.md §3:
  // "APPOINTMENT_*", "EXAM_*", "EXAM_RESULT_*"; `CLINIC_*`/`ADMIN_CLINIC_*` acrescentados por
  // extensão do mesmo critério — clínicas não são "dados de saúde" por categoria, mas toda
  // escrita é auditada, conventions.md §2):
  | "APPOINTMENT_CREATE"
  | "APPOINTMENT_UPDATE"
  | "APPOINTMENT_DELETE"
  | "APPOINTMENT_STATUS"
  // M14 Q (BR-CLN-26): resposta "Vou / Não posso" do paciente; `metadata.response` apenas.
  | "APPOINTMENT_CONFIRMATION_SET"
  | "EXAM_CREATE"
  | "EXAM_UPDATE"
  | "EXAM_DELETE"
  | "EXAM_STATUS"
  | "EXAM_RESULT_CREATE"
  | "EXAM_RESULT_UPDATE"
  | "EXAM_RESULT_DELETE"
  // Exames de clínica parceira (D19/ADR-023, audit.md §3): marcação da família (`EXAM_CREATE` com `metadata.slotId`) e ações da conta da clínica.
  | "EXAM_CLINIC_CANCEL"
  | "EXAM_CLINIC_COMPLETE"
  | "EXAM_DOCUMENT_UPLOAD"
  // Recomendações da clínica (D19/ADR-023, BR-CLN-09): `metadata` nunca com o texto (BR-HLT-05).
  | "RECOMMENDATION_CREATE"
  | "RECOMMENDATION_VIEW"
  | "CLINIC_CREATE"
  | "CLINIC_UPDATE"
  | "CLINIC_STATUS"
  | "CLINIC_DELETE"
  | "ADMIN_CLINIC_CREATE"
  | "ADMIN_CLINIC_UPDATE"
  | "ADMIN_CLINIC_STATUS"
  // `admin` (M9 — FR-ADM-01, audit.md §3): contas de utilizador.
  | "ADMIN_USER_SUSPEND"
  | "ADMIN_USER_REACTIVATE"
  | "ADMIN_USER_RESET_ACCESS"
  // Contas do portal da clínica (BR-ADM-04, ADR-023): sem motivo/PII no metadata.
  | "ADMIN_CLINIC_ACCOUNT_SUSPEND"
  | "ADMIN_CLINIC_ACCOUNT_REACTIVATE"
  | "ADMIN_PLATFORM_ADMIN_CREATE"
  // `lifecycle` (M9 — UC-MEM-10, BR-MEM-10/11): maioridade e apagamento de perfis bloqueados.
  | "MEMBER_COMING_OF_AGE"
  | "MEMBER_BLOCKED_DELETE"
  // Portal da clínica (D17/D18, ADR-020, `clinics` — identidade `ClinicAccount` separada de
  // `User`): login/refresh/logout próprios + reposição da conta raiz pelo Platform Admin.
  | "CLINIC_ACCOUNT_LOGIN"
  | "CLINIC_ACCOUNT_LOGIN_FAILED"
  | "CLINIC_ACCOUNT_LOGOUT"
  | "CLINIC_ACCOUNT_REFRESH_REUSE_DETECTED"
  | "ADMIN_CLINIC_ROOT_ACCOUNT_CREATE"
  // Hierarquia de staff e horários do portal da clínica (Fase C, BR-CLN-04/05, D18): o próprio
  // `CLINIC_ADMIN` gere os `CLINIC_MANAGER` da sua clínica; qualquer papel publica/remove horários.
  | "CLINIC_STAFF_CREATE"
  | "CLINIC_STAFF_REMOVE"
  | "CLINIC_SLOT_PUBLISH"
  | "CLINIC_SLOT_UPDATE"
  | "CLINIC_SLOT_REMOVE"
  // Marcação presencial pela clínica (D20, ADR-024, BR-CLN-10): nunca o e-mail pesquisado nem o displayName.
  | "CLINIC_WALKIN_LOOKUP"
  | "CLINIC_WALKIN_BOOK"
  // Portal da clínica v2 (M14 a1/a2, ADR-026, audit.md §3): metadata só com ids internos, flags, `kind` e
  // contagens — nunca nomes, especialidade, preços, motivo do bloqueio nem dados de pacientes.
  | "CLINIC_PROFESSIONAL_CREATE"
  | "CLINIC_PROFESSIONAL_UPDATE"
  | "CLINIC_SERVICE_CREATE"
  | "CLINIC_SERVICE_UPDATE"
  | "CLINIC_SCHEDULE_RULE_CREATE"
  | "CLINIC_SCHEDULE_RULE_UPDATE"
  | "CLINIC_SCHEDULE_RULE_REGENERATE"
  | "CLINIC_SCHEDULE_GENERATE"
  | "CLINIC_TIME_OFF_CREATE"
  | "CLINIC_TIME_OFF_DELETE"
  // Pacientes da clínica, consentimento e ligação (M14 P, ADR-026, audit.md §3): `metadata` só com ids internos,
  // `origin`, `level`, `via`, flags, nomes de campos e contagens — nunca nome, telefone, e-mail, notas, `q`, código.
  | "CLINIC_PATIENT_CREATE"
  | "CLINIC_PATIENT_UPDATE"
  | "CLINIC_PATIENT_LINK"
  | "CLINIC_SHARED_HISTORY_VIEW"
  | "CLINIC_VISIT_BOOK"
  | "CLINIC_VISIT_CANCEL"
  | "CLINIC_VISIT_COMPLETE"
  // Confirmação por telefone, fluxo do dia e retorno (M14 Q, BR-CLN-27/28/30, audit.md §3): ids internos e, em `SET`,
  // `amount`/`unit`; nunca dados pessoais.
  | "CLINIC_APPOINTMENT_CONFIRM"
  | "CLINIC_APPOINTMENT_ARRIVE"
  | "CLINIC_APPOINTMENT_START"
  | "CLINIC_APPOINTMENT_NO_SHOW"
  | "CLINIC_VISIT_CONFIRM"
  | "CLINIC_VISIT_ARRIVE"
  | "CLINIC_VISIT_START"
  | "CLINIC_VISIT_NO_SHOW"
  | "CLINIC_FOLLOWUP_SET"
  | "CLINIC_FOLLOWUP_CLEAR"
  | "CLINIC_CONSENT_SET"
  | "CLINIC_CONSENT_REVOKE"
  | "CLINIC_LINK_CODE_CREATE"
  | "CLINIC_LINK_CODES_PURGE"
  // M14 R (audit.md §3): recibos e perfil da clínica; `metadata` nunca com nomes, descrições, valores, motivo nem texto.
  | "CLINIC_RECEIPT_ISSUE"
  | "CLINIC_RECEIPT_VOID"
  | "CLINIC_PROFILE_UPDATE"
  // M15 S/T (ADR-027, audit.md §3): relatório da consulta, rascunho de resultados e laudo gerado; `metadata` só com ids e
  // contagens, NUNCA texto, nomes, valores nem diagnóstico (BR-HLT-05).
  | "CONSULT_REPORT_SAVED"
  | "CONSULT_REPORT_FINALIZED"
  | "CONSULT_REPORT_AMENDED"
  | "CONSULT_REPORT_VIEWED"
  | "EXAM_RESULTS_DRAFT_SAVED"
  | "EXAM_RESULTS_DRAFT_DISCARDED"
  | "EXAM_REPORT_GENERATED"
  | "EXAM_REPORT_DOWNLOAD"
  // M15 U/V (ADR-028, audit.md §3): pedido de exame e declaração de presença; `metadata` só com ids e contagens, NUNCA o nome do
  // exame, a nota nem o nome do paciente (BR-HLT-05).
  | "EXAM_ORDER_CREATED"
  | "EXAM_ORDER_CANCELLED"
  | "EXAM_ORDER_VIEWED"
  | "EXAM_ORDER_LINKED"
  | "ATTENDANCE_STATEMENT_ISSUED"
  // Seguradoras e portal da seguradora (ADR-021/ADR-023, BR-ADM-05/06, BR-INS-06): sem PII no metadata.
  | "ADMIN_INSURER_CREATE"
  | "ADMIN_INSURER_UPDATE"
  | "ADMIN_INSURER_STATUS"
  | "ADMIN_INSURER_ROOT_ACCOUNT"
  | "INSURANCE_ACCOUNT_LOGIN"
  | "INSURANCE_ACCOUNT_LOGIN_FAILED"
  | "INSURANCE_ACCOUNT_LOGOUT"
  | "INSURANCE_ACCOUNT_REFRESH_REUSE_DETECTED"
  | "INSURANCE_AGENT_CREATE"
  | "INSURANCE_AGENT_REMOVE"
  // Apólices e pedidos de reembolso (Fase 4b, ADR-021): `metadata` nunca com valores/identificadores de apólice (BR-HLT-05).
  | "INSURANCE_POLICY_CREATE"
  | "INSURANCE_POLICY_UPDATE"
  | "INSURANCE_POLICY_DELETE"
  | "CLAIM_SUBMIT"
  | "CLAIM_DECIDE"
  | "CLAIM_PAID";

export type AuditActorType = "USER" | "SYSTEM" | "PLATFORM_ADMIN" | "CLINIC_ACCOUNT" | "INSURANCE_ACCOUNT";

export type AuditResult = "SUCCESS" | "DENIED" | "FAILURE";

/**
 * Metadados livres do evento — só identificadores, contagens, estados (enum) anteriores/novos
 * (audit.md regra 2). Nunca texto livre de saúde.
 */
export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditEvent {
  occurredAt: Date;
  actorType: AuditActorType;
  /** `undefined` para ações sem User identificável (ex.: falha de login com e-mail inexistente). */
  actorUserId?: string;
  /** D18: preenchido só quando `actorType==='CLINIC_ACCOUNT'` (schema.md §5). */
  actorClinicAccountId?: string;
  /**
   * M14 R (BR-CLN-40): clínica da conta quando `actorType==='CLINIC_ACCOUNT'`. Se omitido, o repositório usa a clínica do
   * ator do pedido (token) quando coincide com `actorClinicAccountId`; os eventos sem sessão (login) passam-no explicitamente.
   */
  actorClinicId?: string;
  /** ADR-021: preenchido só quando `actorType==='INSURANCE_ACCOUNT'` (schema.md §5). */
  actorInsuranceAccountId?: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  familyId?: string;
  subjectMemberId?: string;
  result: AuditResult;
  ip?: string;
  userAgent?: string;
  requestId: string;
  metadata?: AuditMetadata;
}

/**
 * Constrói só as chaves `ip`/`userAgent` presentes em `context` — `exactOptionalPropertyTypes`
 * (tsconfig) proíbe atribuir `undefined` explicitamente a uma propriedade opcional; espalhar o
 * resultado (`...auditContextFields(ctx)`) evita repetir esta ginástica em cada caso de uso.
 */
export function auditContextFields(context: {
  ip?: string;
  userAgent?: string;
}): Partial<Pick<AuditEvent, "ip" | "userAgent">> {
  const fields: Partial<Pick<AuditEvent, "ip" | "userAgent">> = {};
  if (context.ip !== undefined) {
    fields.ip = context.ip;
  }
  if (context.userAgent !== undefined) {
    fields.userAgent = context.userAgent;
  }
  return fields;
}
