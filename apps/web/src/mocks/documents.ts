import { AppError } from '@/lib/errors'
import type { DocumentInfo, DocumentResourceType, DocumentUpload } from '@/types/document'
import { DOCUMENT_MAX_BYTES, DOCUMENT_MIME_TYPES, DOCUMENTS_PER_RESOURCE } from '@/types/document'
import { db, newId } from './db'

/** BR-DOC-01/03: PDF, JPG ou PNG até 10 MB, no máximo 5 por recurso. */
export function validateUploads(uploads: DocumentUpload[]) {
  if (uploads.length > DOCUMENTS_PER_RESOURCE) throw new AppError('VALIDATION_ERROR')
  for (const doc of uploads) {
    const allowed = (DOCUMENT_MIME_TYPES as readonly string[]).includes(doc.mimeType)
    if (!allowed || doc.sizeBytes > DOCUMENT_MAX_BYTES) throw new AppError('VALIDATION_ERROR')
  }
}

export function attachDocuments(
  uploads: DocumentUpload[],
  owner: { familyId: string; memberId: string; resourceType: DocumentResourceType; resourceId: string },
  now: Date,
) {
  for (const doc of uploads) {
    db.documents.push({ ...doc, ...owner, id: newId('doc'), createdAt: now.toISOString() })
  }
}

export function documentsOf(resourceType: DocumentResourceType, resourceId: string): DocumentInfo[] {
  return db.documents.filter((d) => d.resourceType === resourceType && d.resourceId === resourceId)
}
