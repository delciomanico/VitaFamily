import { apiFetch, apiFetchBlob } from '@/lib/apiClient'
import type { DocumentInfo, DocumentResourceType, DocumentUpload } from '@/types/document'

/** `Document` (openapi.yaml): sem `familyId`/`memberId`. */
interface ApiDocument {
  id: string
  resourceType: DocumentResourceType
  resourceId: string
  originalName: string
  mimeType: string
  sizeBytes: number
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED'
  createdAt: string
}

const base = (familyId: string, memberId: string) => `/families/${familyId}/members/${memberId}/documents`

/** `POST …/documents` (multipart): um pedido por ficheiro; o tipo é verificado pelo conteúdo no servidor. */
export async function apiUploadDocuments(
  familyId: string,
  memberId: string,
  resourceType: DocumentResourceType,
  resourceId: string,
  uploads: DocumentUpload[],
): Promise<void> {
  for (const upload of uploads) {
    if (!upload.file) continue
    const form = new FormData()
    form.append('resourceType', resourceType)
    form.append('resourceId', resourceId)
    form.append('file', upload.file, upload.originalName)
    await apiFetch<ApiDocument>(base(familyId, memberId), { method: 'POST', body: form })
  }
}

/** `GET …/documents?resourceType&resourceId`. Sem permissão de leitura devolve lista vazia. */
export async function apiListDocuments(
  familyId: string,
  memberId: string,
  resourceType: DocumentResourceType,
  resourceId: string,
): Promise<DocumentInfo[]> {
  const list = await apiFetch<ApiDocument[]>(
    `${base(familyId, memberId)}?resourceType=${resourceType}&resourceId=${resourceId}`,
  ).catch(() => [] as ApiDocument[])
  return list.map((d) => ({ ...d, familyId, memberId }))
}

/** `GET …/documents/{id}/download` (stream mediado, só com análise limpa). */
export function apiDownloadDocument(document: DocumentInfo): Promise<Blob> {
  return apiFetchBlob(`${base(document.familyId, document.memberId)}/${document.id}/download`)
}
