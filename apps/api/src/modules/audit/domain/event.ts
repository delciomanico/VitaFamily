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
  | "EXAM_CREATE"
  | "EXAM_UPDATE"
  | "EXAM_DELETE"
  | "EXAM_STATUS"
  | "EXAM_RESULT_CREATE"
  | "EXAM_RESULT_UPDATE"
  | "EXAM_RESULT_DELETE"
  | "CLINIC_CREATE"
  | "CLINIC_UPDATE"
  | "CLINIC_STATUS"
  | "CLINIC_DELETE"
  | "ADMIN_CLINIC_CREATE"
  | "ADMIN_CLINIC_UPDATE"
  | "ADMIN_CLINIC_STATUS";

export type AuditActorType = "USER" | "SYSTEM" | "PLATFORM_ADMIN";

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
