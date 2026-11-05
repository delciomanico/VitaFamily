// API pública cruzada entre módulos (modules.md §2: `documents` expõe `DocumentService`) — pensada
// para a frente, para os casos de uso de eliminação de recurso de M6 (`prescriptions`) e M7
// (`examinations`), que ainda não existem (CLAUDE.md/prompt §29: não implementar nada deles agora).
// Mesmo padrão de `schema.md` §7 para `users`/`families`: antes de apagar o recurso, obter os
// `storage_key` dos documentos ligados e enfileirar `file_deletions`, NA MESMA transação do
// chamador — por isso estas funções recebem `trx` diretamente (nunca abrem a sua própria
// transação, ao contrário dos casos de uso ligados a rotas HTTP deste módulo).
import type { Document, DocumentsDeps, ResourceType } from "./ports.js";
import { isVisibleToPatient } from "./support.js";

export function createListForResourceUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  return async function listForResource(
    trx: Trx,
    familyId: string,
    memberId: string,
    resourceType: ResourceType,
    resourceId: string,
  ): Promise<Document[]> {
    return deps.documentsRepo.listByResource(trx, familyId, memberId, resourceType, resourceId);
  };
}

export function createDeleteAllForResourceUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  return async function deleteAllForResource(
    trx: Trx,
    familyId: string,
    memberId: string,
    resourceType: ResourceType,
    resourceId: string,
  ): Promise<void> {
    const documents = await deps.documentsRepo.listByResource(trx, familyId, memberId, resourceType, resourceId);
    for (const document of documents) {
      // Outbox ANTES de apagar a linha (schema.md §7, ADR-011) — se o apagamento do ficheiro
      // falhar mais tarde, o job `lifecycle.delete-files` tenta de novo; nunca fica órfão silencioso.
      await deps.fileDeletionsRepo.enqueue(trx, document.storageKey);
      await deps.documentsRepo.delete(trx, familyId, memberId, document.id);
    }
  };
}

/**
 * ADR-021/BR-INS-04 (`insurance`): dos `documentIds` pedidos, devolve só os documentos DO MEMBRO que
 * podem acompanhar um pedido de reembolso — verificados pelo antivírus (`CLEAN`; quarentena e infetados
 * nunca saem do titular) e visíveis ao paciente (BR-CLN-08: PDF da clínica só com o exame `COMPLETED`).
 * Quem chama compara a contagem: o que faltar é inválido. Corre na transação do chamador.
 */
export function createListAttachableUseCase<Trx>(deps: DocumentsDeps<Trx>) {
  return async function listAttachable(trx: Trx, familyId: string, memberId: string, documentIds: string[]): Promise<Document[]> {
    const found = await deps.documentsRepo.listByIds(trx, familyId, memberId, documentIds);
    const attachable: Document[] = [];
    for (const document of found) {
      if (document.scanStatus === "CLEAN" && (await isVisibleToPatient(deps, trx, document))) {
        attachable.push(document);
      }
    }
    return attachable;
  };
}
