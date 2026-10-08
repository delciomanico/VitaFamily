// Catálogo de códigos de erro da API — fonte: docs/05-api/errors.md (Fase 13).
// `code` é estável: os clientes dependem dele, não da mensagem (`title`/`detail`).
// Qualquer código novo tem de ser adicionado primeiro em errors.md (contrato), depois aqui.

export type ErrorCode =
  | "MALFORMED_REQUEST"
  | "AUTH_INVALID_CREDENTIALS"
  | "TOKEN_EXPIRED"
  | "UNAUTHENTICATED"
  | "ACCOUNT_SUSPENDED"
  | "EMAIL_NOT_VERIFIED"
  | "FORBIDDEN"
  | "INVITATION_EMAIL_MISMATCH"
  | "TERMS_REACCEPTANCE_REQUIRED"
  | "INVITATION_INVALID"
  | "NOT_FOUND"
  | "ACCOUNT_DELETION_BLOCKED"
  | "CONFLICT"
  | "DOCUMENT_LIMIT_EXCEEDED"
  | "DOCUMENT_NOT_AVAILABLE"
  | "DOSE_IN_FUTURE"
  | "DOSE_WINDOW_EXPIRED"
  | "EXPORT_NOT_READY"
  | "FAMILY_NOT_EMPTY"
  | "INVALID_STATE_TRANSITION"
  | "LAST_ADMIN"
  | "LAST_GUARDIAN"
  | "LIMIT_EXCEEDED"
  | "STORAGE_QUOTA_EXCEEDED"
  | "INVITATION_EXPIRED"
  | "FILE_TOO_LARGE"
  | "FILE_TYPE_NOT_ALLOWED"
  | "AGE_REQUIREMENT_NOT_MET"
  | "BIRTHDATE_MISMATCH"
  | "DEPENDENT_ACCOUNT_AGE"
  | "DEPENDENT_REQUIRES_GUARDIAN"
  | "GUARDIAN_INVALID"
  | "INVALID_SCHEDULE"
  | "MINOR_MUST_BE_DEPENDENT"
  | "PASSWORD_WEAK"
  | "VALIDATION_ERROR"
  | "MEMBER_BLOCKED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

interface CatalogEntry {
  status: number;
  title: string;
}

/** HTTP e título (pt-PT, sem dados de saúde) por código — ver errors.md. */
export const errorCatalog: Record<ErrorCode, CatalogEntry> = {
  MALFORMED_REQUEST: { status: 400, title: "Pedido malformado" },
  AUTH_INVALID_CREDENTIALS: { status: 401, title: "Credenciais inválidas" },
  TOKEN_EXPIRED: { status: 401, title: "Sessão expirada" },
  UNAUTHENTICATED: { status: 401, title: "Sem sessão válida" },
  ACCOUNT_SUSPENDED: { status: 403, title: "Conta suspensa" },
  EMAIL_NOT_VERIFIED: { status: 403, title: "E-mail por verificar" },
  FORBIDDEN: { status: 403, title: "Sem permissão" },
  INVITATION_EMAIL_MISMATCH: { status: 403, title: "E-mail diferente do convite" },
  TERMS_REACCEPTANCE_REQUIRED: { status: 403, title: "Novos termos por aceitar" },
  INVITATION_INVALID: { status: 404, title: "Convite inválido" },
  NOT_FOUND: { status: 404, title: "Não encontrado" },
  ACCOUNT_DELETION_BLOCKED: { status: 409, title: "Eliminação da conta bloqueada" },
  CONFLICT: { status: 409, title: "Conflito" },
  DOCUMENT_LIMIT_EXCEEDED: { status: 409, title: "Limite de ficheiros excedido" },
  DOCUMENT_NOT_AVAILABLE: { status: 409, title: "Documento indisponível" },
  DOSE_IN_FUTURE: { status: 409, title: "Toma futura" },
  DOSE_WINDOW_EXPIRED: { status: 409, title: "Janela da toma expirada" },
  EXPORT_NOT_READY: { status: 409, title: "Exportação ainda não está pronta" },
  FAMILY_NOT_EMPTY: { status: 409, title: "A família ainda tem membros" },
  INVALID_STATE_TRANSITION: { status: 409, title: "Transição de estado não permitida" },
  LAST_ADMIN: { status: 409, title: "Último administrador da família" },
  LAST_GUARDIAN: { status: 409, title: "Último tutor do dependente" },
  LIMIT_EXCEEDED: { status: 409, title: "Limite atingido" },
  STORAGE_QUOTA_EXCEEDED: { status: 409, title: "Quota de armazenamento excedida" },
  INVITATION_EXPIRED: { status: 410, title: "Convite expirado" },
  FILE_TOO_LARGE: { status: 413, title: "Ficheiro demasiado grande" },
  FILE_TYPE_NOT_ALLOWED: { status: 415, title: "Tipo de ficheiro não permitido" },
  AGE_REQUIREMENT_NOT_MET: { status: 422, title: "Idade mínima não cumprida" },
  BIRTHDATE_MISMATCH: { status: 422, title: "Data de nascimento não coincide" },
  DEPENDENT_ACCOUNT_AGE: { status: 422, title: "Idade mínima para conta de dependente" },
  DEPENDENT_REQUIRES_GUARDIAN: { status: 422, title: "Dependente exige tutor" },
  GUARDIAN_INVALID: { status: 422, title: "Tutor inválido" },
  INVALID_SCHEDULE: { status: 422, title: "Plano de toma inválido" },
  MINOR_MUST_BE_DEPENDENT: { status: 422, title: "Menor tem de ser dependente" },
  PASSWORD_WEAK: { status: 422, title: "Palavra-passe fraca" },
  VALIDATION_ERROR: { status: 422, title: "Dados inválidos" },
  MEMBER_BLOCKED: { status: 423, title: "Perfil bloqueado" },
  RATE_LIMITED: { status: 429, title: "Demasiados pedidos" },
  INTERNAL_ERROR: { status: 500, title: "Erro interno" },
  SERVICE_UNAVAILABLE: { status: 503, title: "Serviço indisponível" },
};

/** Estado HTTP do código. */
export function statusForCode(code: ErrorCode): number {
  return errorCatalog[code].status;
}
