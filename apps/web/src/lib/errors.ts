/** Códigos de erro partilhados pela camada de serviços (alinhados com docs/05-api/errors.md). */
export type ErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_SUSPENDED'
  | 'AGE_REQUIREMENT_NOT_MET'
  | 'PASSWORD_WEAK'
  | 'INVALID_CODE'
  | 'INVITATION_INVALID'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_EMAIL_MISMATCH'
  | 'BIRTHDATE_MISMATCH'
  | 'LIMIT_EXCEEDED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'LAST_ADMIN'
  | 'LAST_GUARDIAN'
  | 'ACCOUNT_DELETION_BLOCKED'
  | 'RATE_LIMITED'
  | 'MEMBER_BLOCKED'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_NOT_ALLOWED'
  | 'INVALID_STATE_TRANSITION'
  | 'DOCUMENT_LIMIT_EXCEEDED'
  | 'SERVICE_UNAVAILABLE'
  | 'PROFESSIONAL_LOCKED'
  | 'DOCUMENT_NOT_AVAILABLE'
  | 'CONVERSATION_CLOSED'
  | 'SLOT_UNAVAILABLE'
  | 'SELF_BOOKING_NOT_ALLOWED'
  | 'REVIEW_NOT_ALLOWED'
  | 'SHARE_NOT_AVAILABLE'
  | 'SHARE_ALREADY_VIEWED'
  | 'UNKNOWN'

export class AppError extends Error {
  readonly code: ErrorCode
  /** Segundos de espera (cabeçalho `Retry-After` de um 429), quando o servidor os indica. */
  readonly retryAfterSeconds?: number

  constructor(code: ErrorCode, retryAfterSeconds?: number) {
    super(code)
    this.name = 'AppError'
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const messages: Record<ErrorCode, string> = {
  INVALID_CREDENTIALS: 'E-mail ou palavra-passe incorretos.',
  EMAIL_NOT_VERIFIED: 'Confirme o seu e-mail para continuar.',
  ACCOUNT_SUSPENDED: 'Esta conta está suspensa. Contacte o suporte.',
  AGE_REQUIREMENT_NOT_MET: 'É necessário ter 18 anos ou mais para criar conta.',
  PASSWORD_WEAK: 'A palavra-passe deve ter pelo menos 12 caracteres.',
  INVALID_CODE: 'Código inválido ou expirado.',
  INVITATION_INVALID: 'Este convite é inválido, já foi usado ou foi revogado.',
  INVITATION_EXPIRED: 'Este convite expirou. Peça um novo convite a quem o enviou.',
  INVITATION_EMAIL_MISMATCH: 'Este convite foi enviado para outro e-mail.',
  BIRTHDATE_MISMATCH: 'A data de nascimento não coincide com o perfil convidado.',
  LIMIT_EXCEEDED: 'Foi atingido o limite permitido. Não é possível continuar.',
  FORBIDDEN: 'Não tem permissão para esta ação.',
  NOT_FOUND: 'Não encontrámos o que procura.',
  VALIDATION_ERROR: 'Verifique os dados introduzidos.',
  CONFLICT: 'Os dados mudaram entretanto. Atualize e tente novamente.',
  LAST_ADMIN: 'A família ficaria sem Administrador. Torne outra pessoa Admin primeiro.',
  LAST_GUARDIAN: 'Esta pessoa é a única tutora de um dependente. Atribua outro tutor primeiro.',
  ACCOUNT_DELETION_BLOCKED:
    'Ainda não pode eliminar a conta: é o único tutor de um dependente ou o único Admin de uma família com outros membros.',
  RATE_LIMITED: 'Fez demasiados pedidos. Tente mais tarde.',
  MEMBER_BLOCKED: 'O perfil deste membro está bloqueado.',
  FILE_TOO_LARGE: 'O ficheiro é demasiado grande.',
  FILE_TYPE_NOT_ALLOWED: 'Tipo de ficheiro não permitido. Use PDF, JPG ou PNG.',
  INVALID_STATE_TRANSITION: 'O pedido já mudou de estado. Atualize a página.',
  DOCUMENT_LIMIT_EXCEEDED: 'Já tem 5 anexos neste pedido. Remova um para juntar outro.',
  SERVICE_UNAVAILABLE: 'Não foi possível verificar o ficheiro agora. Tente mais tarde.',
  PROFESSIONAL_LOCKED: 'Neste estado não pode alterar isto. Se precisar, peça ao administrador para reabrir o perfil.',
  DOCUMENT_NOT_AVAILABLE: 'Este ficheiro ainda não está disponível para descarregar.',
  CONVERSATION_CLOSED: 'Esta conversa já não aceita mensagens: está fechada ou o profissional está indisponível.',
  SLOT_UNAVAILABLE: 'Esse horário acabou de ser ocupado. Escolha outro.',
  SELF_BOOKING_NOT_ALLOWED: 'Não pode marcar nem avaliar o seu próprio serviço.',
  REVIEW_NOT_ALLOWED: 'Já não é possível avaliar esta consulta.',
  SHARE_NOT_AVAILABLE: 'Esta partilha já não está disponível.',
  SHARE_ALREADY_VIEWED: 'Esta partilha já foi vista e não pode ser aberta outra vez.',
  UNKNOWN: 'Algo correu mal. Tente novamente.',
}

/** Mensagem amigável para mostrar ao utilizador (nunca códigos técnicos). */
export function errorMessage(error: unknown): string {
  return error instanceof AppError ? messages[error.code] : messages.UNKNOWN
}

export function isAppError(error: unknown, code: ErrorCode): boolean {
  return error instanceof AppError && error.code === code
}

/** Anexos da clínica (PDF, JPG ou PNG até 10 MB): ficheiro demasiado grande ou tipo não aceite têm a mesma frase. */
export const ATTACHMENT_FILE_HELP = 'Use PDF, JPG ou PNG, até 10 MB.'
export function attachmentErrorMessage(error: unknown): string {
  return isAppError(error, 'FILE_TYPE_NOT_ALLOWED') || isAppError(error, 'FILE_TOO_LARGE') ? ATTACHMENT_FILE_HELP : errorMessage(error)
}
