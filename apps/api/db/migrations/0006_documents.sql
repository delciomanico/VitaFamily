-- Documentos de receitas/exames (schema.md §3, M5/FR-DOC) + outbox de apagamento de ficheiros
-- (schema.md §5/§7, ADR-011). SQL simples, sem marcadores +goose (ADR-014/ADR-015).
--
-- DECISÃO DE CHANGE CONTROL (pré-aprovada pelo proprietário, registada aqui e em
-- `docs/07-database/migrations.md` e `src/modules/documents/README.md`): `schema.md` §3 define
-- `prescription_id`/`examination_id` como FK para `prescriptions`/`examinations`, mas essas tabelas
-- só existem a partir de M6/M7 — depois de M5 na ordem real do plano (`plan.md` §4), ao contrário da
-- ordem conceptual original de `migrations.md` (que listava documents como 0008, depois de
-- prescriptions/examinations). Resolução: esquema em 2 fases.
--   Fase 1 (esta migração, M5): colunas `prescription_id`/`examination_id` SEM `REFERENCES` (as
--   tabelas-alvo não existem ainda), mas COM o CHECK `num_nonnulls(...) = 1` já — não depende de FK,
--   só dos valores das colunas.
--   Fase 2 (a fazer nas migrações de M6/M7, não nesta): depois de criar `prescriptions`
--   (`ALTER TABLE documents ADD CONSTRAINT documents_prescription_fk FOREIGN KEY (prescription_id)
--   REFERENCES prescriptions (id) ON DELETE CASCADE;`) e, na migração de M7, depois de criar
--   `examinations` (`ALTER TABLE documents ADD CONSTRAINT documents_examination_fk FOREIGN KEY
--   (examination_id) REFERENCES examinations (id) ON DELETE CASCADE;`). Quem implementar M6/M7: não
--   esquecer estas duas migrações — sem elas, o cascata de eliminação de receitas/exames (FR-DOC-04,
--   D15) não apaga automaticamente os `documents`; `documents.deleteAllForResource` (API pública do
--   módulo, `index.ts`) cobre isso enquanto o FK não existir, e continua a ser a forma recomendada
--   de apagar (enfileira `file_deletions` antes de apagar a linha, mesmo sem FK ON DELETE CASCADE).

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  member_id uuid NOT NULL,
  prescription_id uuid,
  examination_id uuid,
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  scan_status scan_status NOT NULL DEFAULT 'PENDING',
  uploaded_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_exactly_one_resource CHECK (num_nonnulls(prescription_id, examination_id) = 1),
  CONSTRAINT documents_size_bytes_range CHECK (size_bytes BETWEEN 1 AND 10485760),
  CONSTRAINT documents_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
-- Listagens por recurso (quota de 5 ficheiros, Q10) e por família (quota de 100 MB, Q10).
CREATE INDEX documents_prescription_idx ON documents (prescription_id) WHERE prescription_id IS NOT NULL;
CREATE INDEX documents_examination_idx ON documents (examination_id) WHERE examination_id IS NOT NULL;
CREATE INDEX documents_family_id_idx ON documents (family_id);
CREATE INDEX documents_member_id_idx ON documents (member_id);

-- Outbox de apagamento de ficheiros (schema.md §5/§7, ADR-011): transversal — qualquer módulo que
-- precise de apagar um ficheiro do armazenamento (`documents` já, `lifecycle` em M9 para
-- `data_exports`) enfileira aqui, na mesma transação do apagamento dos metadados. Sem FK por
-- desenho (`storage_key text NN` — sobrevive à eliminação da linha que o referia, mesmo critério de
-- `audit_logs` não ter FK). Processada pelo job `lifecycle.delete-files` (modules.md §5, M9); até lá,
-- `documents` é o único a escrever aqui (ver `documents/README.md`).
CREATE TABLE file_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX file_deletions_pending_idx ON file_deletions (created_at) WHERE deleted_at IS NULL;
