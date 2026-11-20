import { errorMessage, isAppError } from '@/lib/errors'

export const MAX_NUMBER = 60
export const MAX_ENTITY = 120
export const FILE_HELP = 'Use PDF, JPG ou PNG, até 10 MB.'

/**
 * Mensagens de recusa do servidor. A genérica de `errorMessage` para ficheiros fala de CSV/XLSX (outro
 * módulo), por isso aqui usa-se a frase das credenciais.
 */
export function uploadErrorMessage(error: unknown): string {
  if (isAppError(error, 'FILE_TYPE_NOT_ALLOWED')) return `Tipo de ficheiro não permitido. ${FILE_HELP}`
  if (isAppError(error, 'FILE_TOO_LARGE')) return `O ficheiro é demasiado grande. ${FILE_HELP}`
  if (isAppError(error, 'LIMIT_EXCEEDED')) return 'Já tem o máximo de 10 documentos. Remova um para juntar outro.'
  return errorMessage(error)
}
