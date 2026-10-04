/** Códigos de erro partilhados pela camada de serviços (alinhados com docs/05-api/errors.md). */
export type ErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_SUSPENDED'
  | 'AGE_REQUIREMENT_NOT_MET'
  | 'PASSWORD_WEAK'
  | 'INVALID_CODE'
  | 'INVITATION_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'UNKNOWN'

export class AppError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode) {
    super(code)
    this.name = 'AppError'
    this.code = code
  }
}

const messages: Record<ErrorCode, string> = {
  INVALID_CREDENTIALS: 'E-mail ou palavra-passe incorretos.',
  EMAIL_NOT_VERIFIED: 'Confirme o seu e-mail para continuar.',
  ACCOUNT_SUSPENDED: 'Esta conta está suspensa. Contacte o suporte.',
  AGE_REQUIREMENT_NOT_MET: 'É necessário ter 18 anos ou mais para criar conta.',
  PASSWORD_WEAK: 'A palavra-passe deve ter pelo menos 12 caracteres.',
  INVALID_CODE: 'Código inválido ou expirado.',
  INVITATION_INVALID: 'Código de convite inválido ou expirado.',
  FORBIDDEN: 'Não tem permissão para esta ação.',
  NOT_FOUND: 'Não encontrámos o que procura.',
  VALIDATION_ERROR: 'Verifique os dados introduzidos.',
  CONFLICT: 'Os dados mudaram entretanto. Atualize e tente novamente.',
  UNKNOWN: 'Algo correu mal. Tente novamente.',
}

/** Mensagem amigável para mostrar ao utilizador (nunca códigos técnicos). */
export function errorMessage(error: unknown): string {
  return error instanceof AppError ? messages[error.code] : messages.UNKNOWN
}

export function isAppError(error: unknown, code: ErrorCode): boolean {
  return error instanceof AppError && error.code === code
}
