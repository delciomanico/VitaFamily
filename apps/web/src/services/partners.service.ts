import * as api from '@/mocks/handlers/partners'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import type { PublicPartner } from '@/types/partner'

/**
 * `GET /public/partners` (API real, sem autenticação): clínicas parceiras ativas. O endpoint ainda não existe no contrato (docs/05-api):
 * enquanto não for aprovado e implementado, a API real devolve erro e a página mostra o estado
 * «indisponível» em vez de dados inventados.
 */
async function apiListPartners(): Promise<PublicPartner[]> {
  const list = await apiFetch<PublicPartner[]>('/public/partners')
  // Só clínicas: entradas de outro tipo (legado) são ignoradas.
  return list.filter((p) => p.kind === 'CLINIC').sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'))
}

export const partnersService = {
  listPartners: hasApiBackend() ? apiListPartners : api.listPublicPartners,
}
