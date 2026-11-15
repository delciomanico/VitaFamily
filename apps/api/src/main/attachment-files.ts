// Adaptador de `AttachmentFiles` (porta de `insurer-ops/application`, modules.md nota 31d): `Storage` + antivírus + outbox
// `file_deletions`. Vive no composition root para que `insurer-ops` não dependa de `documents` nem de bibliotecas de I/O.
import type { Kysely } from "kysely";
import type { Database } from "../platform/db/index.js";
import type { Storage } from "../platform/storage/index.js";
import type { AttachmentFiles } from "../modules/insurer-ops/index.js";
import type { VirusScanner } from "../modules/documents/index.js";

export function createAttachmentFiles(deps: { storage: Storage; virusScanner: VirusScanner }): AttachmentFiles<Kysely<Database>> {
  return {
    scan: (buffer) => deps.virusScanner.scan(buffer),
    put: (key, buffer, mimeType) => deps.storage.putObject(key, buffer, mimeType),
    // Fatia 4: o analista/supervisor descarrega em stream, mediado pela API (ADR-006).
    get: (key) => deps.storage.getObject(key),
    // Outbox (ADR-011): o ficheiro só é apagado depois de a transação do pedido comitar; o job `lifecycle.delete-files` esvazia-o.
    scheduleDelete: async (trx, key) => {
      await trx.insertInto("file_deletions").values({ storage_key: key }).execute();
    },
  };
}
