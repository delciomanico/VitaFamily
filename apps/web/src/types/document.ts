/** Documento anexado — docs/04-domain/entities.md → Document (sem armazenamento real nos mocks). */
export type DocumentResourceType = 'PRESCRIPTION' | 'EXAMINATION' | 'INSURANCE_POLICY'

export interface DocumentInfo {
  id: string
  familyId: string
  memberId: string
  resourceType: DocumentResourceType
  resourceId: string
  originalName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  /** Análise antivírus (API real, BR-DOC-02); ausente nos mocks. */
  scanStatus?: 'PENDING' | 'CLEAN' | 'INFECTED'
  /** Carregado pela clínica (BR-CLN-08): a família descarrega, a clínica só vê metadados. */
  uploadedByClinic?: boolean
  /** M15 T (BR-CLN-49): laudo gerado pelo sistema (mostrado como "Laudo da clínica"). */
  generatedBySystem?: boolean
}

/** Metadados de um documento enviado (os mocks não guardam o ficheiro). */
export type DocumentUpload = Pick<DocumentInfo, 'originalName' | 'mimeType' | 'sizeBytes'> & {
  /** Ficheiro escolhido; só é enviado com a API real. */
  file?: File
}

/** BR-DOC-01: PDF, JPG ou PNG até 10 MB. */
export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024
/** BR-DOC-03: máximo de ficheiros por recurso. */
export const DOCUMENTS_PER_RESOURCE = 5
