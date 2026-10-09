# Módulo `documents`

M5 (`plan.md` §4): upload, validação por conteúdo (magic bytes), quarentena, antivírus (worker
pg-boss), download mediado, quotas, apagamento via outbox (FR-DOC-01..04, BR-DOC-01..05, N4,
ADR-006, ADR-011).

**Toda a autorização passa por `access.policy.can()`** (`authorization.md` §3) — a categoria é
derivada do `resourceType` do documento (`PRESCRIPTION` -> `MEDICATION`, `EXAMINATION` -> `EXAMS`,
decisão já tomada pelo proprietário, `application/support.ts`), sem nunca precisar de ler as
tabelas `prescriptions`/`examinations` (que só existem a partir de M6/M7).

## Mapa de um pedido típico

```
POST /families/{familyId}/members/{memberId}/documents   (multipart/form-data)
  → interface/router.ts                    # multer (via express-openapi-validator) põe o
                                             #   ficheiro em memória (req.files)
    → application/upload-document.ts
      → domain/rate-limiter.ts             #   20/hora por utilizador (RATE_LIMITED)
      → domain/file-type.ts                #   magic bytes -> PDF/JPG/PNG ou FILE_TYPE_NOT_ALLOWED
      → access/index.js (policy.can)       #   CREATE/MEDICATION|EXAMS -> ALLOW ou DENY
      → infra: countByResource/sumSizeByFamily -> DOCUMENT_LIMIT_EXCEEDED/STORAGE_QUOTA_EXCEEDED
      → domain/storage-key.ts              #   quarantine/{id}.{ext} (nunca a partir do nome do ficheiro)
      → platform/storage (MinioStorage)    #   putObject no prefixo de quarentena (ADR-006)
      → infrastructure/repo.ts             #   insert (scan_status PENDING)
      → audit.record(trx, DOCUMENT_UPLOAD)
      → infrastructure/scan-queue.ts       #   pg-boss.send("documents.scan") — DEPOIS da transação
```

```
worker: job documents.scan
  → application/scan-document.ts          # idempotente: no-op se já não está PENDING
    → platform/storage.getObject          #   lê o ficheiro em quarentena
    → infrastructure/clamav-client.ts     #   INSTREAM ao ClamAV (CLAMAV_HOST:CLAMAV_PORT)
      CLEAN    → storage.copyObject/deleteObject (sai da quarentena) + repo.markClean
               → audit.record(DOCUMENT_SCAN_CLEAN)
      INFECTED → storage.deleteObject + repo.delete (linha desaparece, "upload recusado")
               → audit.record(DOCUMENT_SCAN_INFECTED)
```

```
GET .../documents/{documentId}/download
  → interface/router.ts
    → application/download-document.ts
      → infra: findById -> NOT_FOUND se não existe nesta família/membro
      → access/index.js (policy.can)       #   READ/categoria -> ALLOW ou DENY (errors.md regra 2:
                                             #   403 só se o documento existe na família do actor)
      → scanStatus != CLEAN → DOCUMENT_NOT_AVAILABLE
      → audit.record(trx, DOCUMENT_DOWNLOAD) # sempre, mesmo para o titular (audit.md §3 nota)
    → platform/storage.getObject (fora da transação) → stream.pipe(res)
      router define Cache-Control: private, no-store; Content-Disposition: attachment
```

## Camadas presentes
- `domain/` — `Document`/`ResourceType`/`ScanStatus` (entities.md DM7); `file-type.ts` (magic bytes
  PDF/JPG/PNG, puro); `storage-key.ts` (prefixos quarantine/documents, nunca a partir do nome do
  ficheiro — evita travessia de caminho); `checksum.ts` (SHA-256, `node:crypto`); `rate-limiter.ts`
  (cópia pequena e intencional de `auth`/`families`, mesmo critério já documentado nesses módulos).
- `application/` — um ficheiro por caso de uso (upload/list/get/delete/download/scan) +
  `for-resource.ts` (API pública para M6/M7) + `ports.ts` (`DocumentsRepository`,
  `FileDeletionsRepository`, `VirusScanner`, `ScanQueuePort`, `AccessPolicyPort` reconstruída —
  mesmo critério de `health-records`) + `support.ts` (`categoryForResourceType`,
  `readableToBuffer`) + `fixtures.ts` (fakes).
- `infrastructure/` — `KyselyDocumentsRepository`/`KyselyFileDeletionsRepository`; `schema.ts`
  (tabelas `documents`/`file_deletions`); `clamav-client.ts` (`ClamAvScanner`, protocolo INSTREAM
  sobre `node:net`); `scan-queue.ts` (`PgBossScanQueue`/`registerScanWorker`, pg-boss).
- `interface/router.ts`, `interface/dto.ts` — as 5 rotas de `endpoints.md` ("Documents").
- `platform/storage/index.ts` (**não** é deste módulo, é `platform` — ver nota abaixo): porta
  `Storage` + adaptador `MinioStorage` (SDK oficial `minio`) + fake `InMemoryStorage`.

## Decisões de implementação (ADR-016/escolhas documentadas)

### `platform/storage`: porta `Storage` sobre MinIO
Não existia nenhum módulo a definir isto ainda (`documents` é o primeiro a precisar). Vive em
`platform` (não em `documents/infrastructure`) pelo mesmo critério de `platform/clock`/`platform/db`
— é um detalhe de infraestrutura reutilizável por qualquer módulo futuro que guarde ficheiros
(`lifecycle`/M9, exportações). Usa o SDK oficial `minio` (`tests/architecture-rules.ts` já
antecipava `"minio"` na lista de pacotes de I/O banidos em domain/application/interface, sinal de
que esta era a escolha esperada).

### Cliente ClamAV: sem dependência nova, protocolo INSTREAM escrito à mão
`tests/architecture-rules.ts` também já antecipava um pacote chamado `"clamd"` na mesma lista, mas
**não existe nenhum pacote npm com esse nome exato** no registo público (as alternativas reais —
`clamdjs`, `node-clamav`, `clamav.js` — são wrappers finas de ~100 linhas sobre o mesmo protocolo
INSTREAM, https://docs.clamav.net/manual/Usage/Scanning.html#stream-scan). Em vez de acrescentar
uma dependência para tão pouco código, `infrastructure/clamav-client.ts` implementa o protocolo
directamente sobre `node:net` (builtin, não é biblioteca de I/O de terceiros) — cabeçalho
`zINSTREAM\0`, chunks prefixados por um inteiro de 4 bytes (big-endian) com o tamanho, terminador de
tamanho zero, resposta `... OK`/`... FOUND`/`... ERROR`. Testado com um servidor TCP falso
(`clamav-client.test.ts`) para validar o framing, sem precisar de Docker/ClamAV real no `pnpm test`
(mesmo critério de proporcionalidade de M3/M4: não há `repo.test.ts` nem testes de infraestrutura
com testcontainers para tabelas desses módulos).

### `multipart/form-data`: `express-openapi-validator` já trata disto
Não foi preciso acrescentar `multer` como dependência: `express-openapi-validator` já o usa
internamente (`fileUploader`, por defeito activo com armazenamento em memória) quando o contrato
declara `requestBody.content["multipart/form-data"].schema.format: binary` (como `openapi.yaml`
já fazia para `UploadDocumentRequest`). `interface/router.ts` lê `req.files` pela forma mínima do
objeto que o multer produz (`fieldname`/`originalname`/`buffer`), sem importar `multer` (evita que
a camada `interface` dependa de uma biblioteca de I/O que nem é sua, conventions.md §3.9).

### Limite de tamanho (10 MB): validado em `application`, não no multer
Não se configurou um limite de tamanho no `fileUploader` do `express-openapi-validator`: faria um
erro de limite do multer (413) passar pelo tradutor genérico de erros do validador OpenAPI
(`platform/http/error-middleware.ts`), que não o mapeia para `FILE_TOO_LARGE` (só conhece
400/401/404/405). `upload-document.ts` lê o ficheiro já em memória e compara `buffer.length` com
`UPLOAD_MAX_BYTES`, devolvendo sempre o código certo do catálogo (`errors.md`). Risco residual
aceite no MVP: um ficheiro muito maior que 10 MB ainda consome memória até esse ponto (sem um
limite duro no multer) — aceitável dado o volume esperado (família, não escala).

### `listDocuments`: `resourceType`/`resourceId` tratados como obrigatórios
`openapi.yaml` marca os dois parâmetros de query como opcionais, mas a descrição da autorização
("READ(categoria do recurso)") e do endpoint ("Listar documentos de **um** recurso") só fazem
sentido com um recurso concreto — sem eles não há categoria a verificar. `list-documents.ts` exige
os dois (`VALIDATION_ERROR` se faltar algum); não há caso de uso de "listar todos os documentos do
membro, de todas as categorias" nos documentos de M5. Divergência pequena, resolvida por
interpretação direta da descrição do próprio endpoint — não um comportamento novo inventado.

## Decisão de change control (pré-aprovada pelo proprietário): esquema `documents` em 2 fases
`schema.md` §3 define `prescription_id`/`examination_id` como FK para `prescriptions`/
`examinations`, mas essas tabelas só existem a partir de M6/M7 — depois de M5 na ordem real do
plano (`plan.md` §4), ao contrário da ordem conceptual original de `migrations.md` (que listava
`documents` como `0008`, depois de `prescriptions`/`examinations`).
- **Fase 1 (esta migração, `db/migrations/0006_documents.sql`):** colunas sem `REFERENCES`, mas já
  com o `CHECK num_nonnulls(prescription_id, examination_id) = 1` (não depende de FK).
- **Fase 2 (a fazer em M6/M7, não aqui):** `ALTER TABLE documents ADD CONSTRAINT
  documents_prescription_fk FOREIGN KEY (prescription_id) REFERENCES prescriptions (id) ON DELETE
  CASCADE;` na migração de M6, e o equivalente para `examination_id` → `examinations` em M7. Até
  essas migrações existirem, `deleteAllForResource` (ver abaixo) é a forma correta de apagar os
  documentos de uma receita/exame — não depender só da cascata de FK.

Ver também a nota equivalente em `docs/07-database/migrations.md` e o comentário SQL no topo de
`0006_documents.sql`.

## API pública pensada para a frente (M6/M7): `listForResource`/`deleteAllForResource`
`application/for-resource.ts` expõe duas operações cruas em `DocumentsModule` para os futuros casos
de uso de eliminação de recurso de `prescriptions`/`examinations` (mesmo padrão de `schema.md` §7
para `users`/`families`: antes de apagar o recurso, obter os `storage_key` dos documentos ligados e
enfileirar `file_deletions`, na mesma transação). Recebem `trx` directamente (nunca abrem a sua
própria transação) para participarem na transação do módulo chamador. Nada de `prescriptions`/
`examinations` foi implementado nesta tarefa (fora de âmbito de M5).

## `file_deletions`: tabela transversal, só `documents` escreve por agora
`schema.md` §5/§7 trata `file_deletions` como transversal (sem FK, sobrevive à linha que a
originou — mesmo critério de `audit_logs`). Esta migração (`0006`) cria a tabela porque
`documents` é o primeiro (e único, em M5) módulo a precisar dela; `lifecycle` (M9) vai processá-la
(`lifecycle.delete-files`, modules.md §5) e pode vir a escrever aqui também para outros tipos de
ficheiro (exportações) — não precisa de passar pela API pública de `documents` para isso, porque a
tabela não tem FK para `documents`.

## Processos (modules.md §4)
`documents` corre nos dois processos: `createDocumentsModule` (API, precisa de `access` para
autorizar os pedidos HTTP) e `createDocumentsWorkerModule` (worker, só `storage`+`virusScanner`+
`audit`+`clock` — nunca monta `access`/`families` só para correr o antivírus, que não autoriza
nada). `ScanDocumentDeps` (`application/ports.ts`) é o subconjunto de `DocumentsDeps` que o worker
precisa; `DocumentsDeps` continua estruturalmente compatível (sobreconjunto), por isso o processo
"api" pode continuar a montar um único objecto de dependências.

## Pendente para revisão do proprietário
- Nenhum ponto de comportamento ficou por decidir além do já registado acima (esquema em 2 fases,
  já pré-aprovado; interpretação de `listDocuments`, pequena e justificada pela própria descrição
  do endpoint).
- Teste de integração real contra um ClamAV em contentor (`clamav/clamav:stable`) não foi feito
  (só o framing do protocolo é testado, com um servidor TCP falso) — mesmo critério de
  proporcionalidade usado em M3/M4 para outra infraestrutura externa; se se quiser cobertura contra
  o daemon real, é um teste `*.integration.test.ts` com testcontainers a acrescentar depois, sem
  alterar `clamav-client.ts`.
