# Módulo `consultations`

MK3 do mercado de profissionais (ADR-037, ADR-016; `modules.md` nota 37; `plan.md` «MK3»). Dono das tabelas `bookings`, `payment_proofs`, `reviews`, `review_reports` e `consultation_file_deletions` (migração `0045`, `schema.md` §13). Marcação de uma oferta e de um horário de um profissional `APPROVED`, em nome de um membro; comprovativo de pagamento declarativo; avaliações verificadas.

## O que faz

- **Família** (`SELF`/`TUTOR_OF`, ação `BOOK_PROFESSIONALS` pela porta `BookingAccess`): cria a marcação (`REQUESTED`, com reserva atómica do horário), lista, lê e cancela; envia o comprovativo, descarrega-o e abre disputa (uma vez por comprovativo); cria, edita e lê a sua avaliação de marcações terminadas; consulta os horários do profissional.
- **Profissional** (token de `ProfessionalAccount`; procura sempre por `professionalId` do token): lista, lê, confirma, recusa, cancela, marca como concluída ou falta (`NO_SHOW`); decide comprovativos; responde a avaliações e denuncia avaliações. A vista não expõe ids de família nem de membro, só o `participantLabel`.
- **Admin** (`PLATFORM_ADMIN`): fila de disputas de comprovativos (decisão `CONFIRM_PAYMENT` ou `UPHOLD_REJECTION`); moderação de denúncias de avaliações (`DISMISS`, `HIDE_COMMENT`).
- **Pagamento**: o Vita não recebe nem valida dinheiro. Nada passa a `CONFIRMED` sem decisão explícita do profissional (ou do admin numa disputa).
- **Estados e projeção**: máquina de estados da marcação e do pagamento em `domain/`; `deriveBookingFacts` (`phase`/`hint` de `state-machines.md` Process 1b) alimenta a `ProcessFacts` de `originType=BOOKING` (`getActFacts`, ligado em `main/api.ts`).
- **Avaliações**: `reviewStats` implementa a porta `ReviewStats` de `discovery` (agregações sem textos nem ids de família).
- **Exportação**: `reads.bookings` é a fonte `bookings` da exportação do titular (BR-MKT-64), consumida por `lifecycle` sem `lifecycle` importar `consultations`.

## Mapa de pastas

```
index.ts            raiz pública: createConsultationsModule, createConsultationsJobs, createConsultationsMaintenance,
                    createConsultationsWorkerModule, createSelfDealingGuard, ProofClamAvScanner, PgBossProofScanQueue,
                    PgBossProfessionalNotices, SmtpProfessionalNoticeMailer; re-exporta domain/ e os tipos das portas
domain/             funções puras: booking (estados, transições, limites), payment (comprovativo e disputa), projection
                    (phase/hint), review (elegibilidade, janelas, agregação), text (texto livre), file-type (tipo por conteúdo)
application/        casos de uso (family-bookings, professional-bookings, proofs, admin-disputes, reviews, reconcile,
                    purge-expired, notify-professional, export, act-facts, self-dealing, rate-limiter, cursor, *-views) + ports.ts e review-ports.ts
infrastructure/     repo.ts, proof-repo.ts, review-repo.ts, file-deletion-repo.ts (Kysely), storage-file-store.ts (sobre platform/storage),
                    clamav-client.ts, jobs.ts (pg-boss), mailer-smtp.ts, schema.ts
interface/          family-router, professional-router, admin-router, proofs-router, reviews-router, http-helpers (Express)
```

## Rotas (por router)

| Router | Rotas |
|---|---|
| `interface/family-router.ts` (User, família) | `GET /marketplace/professionals/{professionalId}/slots`; `GET`, `POST /families/{f}/members/{m}/bookings`; `GET .../bookings/{bookingId}`; `POST .../bookings/{bookingId}/cancel` |
| `interface/proofs-router.ts` (família) | `GET`, `POST .../bookings/{bookingId}/payment-proofs`; `GET .../payment-proofs/{proofId}/file`; `POST .../payment-proofs/{proofId}/dispute` |
| `interface/reviews-router.ts` (família) | `GET`, `PUT /families/{f}/members/{m}/bookings/{bookingId}/review`; `GET /marketplace/professionals/{professionalId}/reviews` (público, User autenticado) |
| `interface/professional-router.ts` (token de profissional) | `GET /professional-portal/bookings`; `GET .../bookings/{bookingId}`; `POST .../{bookingId}/confirm`, `/reject`, `/cancel`, `/complete`, `/no-show` |
| `interface/proofs-router.ts` (portal) | `GET /professional-portal/bookings/{bookingId}/payment-proofs/{proofId}/file`; `POST .../{proofId}/decision` |
| `interface/reviews-router.ts` (portal) | `GET /professional-portal/reviews`; `POST .../reviews/{reviewId}/reply`, `POST .../reviews/{reviewId}/reports` |
| `interface/admin-router.ts` (`PLATFORM_ADMIN`) | `GET /admin/payment-disputes`; `GET .../{proofId}`; `GET .../{proofId}/file`; `POST .../{proofId}/decisions` |
| `interface/reviews-router.ts` (admin) | `GET /admin/review-reports`; `GET .../{reportId}`; `POST .../{reportId}/decisions` |

Os routers definem `Cache-Control: no-store`. Os descarregamentos são auditados (`PAYMENT_PROOF_DOWNLOAD`, `PROFESSIONAL_PAYMENT_PROOF_DOWNLOAD`, `ADMIN_PAYMENT_PROOF_DOWNLOAD`).

## Jobs (`infrastructure/jobs.ts`, registados em `main/worker.ts`)

| Fila | Quando | O que faz |
|---|---|---|
| `consultations.scan-proof` | fila (ao enviar comprovativo) | antivírus (`ProofScanner`, ClamAV): `PENDING` → `CLEAN` ou `INFECTED`; infetado conta como não enviado (a linha apaga-se e o ficheiro entra na outbox) |
| `consultations.delete-files` | `*/5 * * * *` | processa `consultation_file_deletions` e apaga os objetos no storage |
| `consultations.reconcile-bookings` | `*/5 * * * *` | cancela com `SYSTEM` (`REQUEST_EXPIRED`) os pedidos `REQUESTED` sem resposta há 48 h, e (`PROFESSIONAL_UNAVAILABLE`) as marcações futuras de profissionais que deixaram de estar `APPROVED`; liberta o horário, atualiza a consulta gerada, alerta `BOOKING_UPDATED`; idempotente; auditoria `BOOKING_AUTO_CANCEL` |
| `consultations.requeue-pending-proofs` | `*/5 * * * *` | volta a enfileirar o antivírus dos comprovativos `PENDING` com mais de 15 min (OP-114 iii) |
| `consultations.notify-professional` | fila (`singletonKey` = marcação+evento; 5 tentativas com recuo) | um e-mail genérico ao profissional por evento (`BOOKING_REQUESTED`, `BOOKING_CANCELLED`, `PROOF_UPLOADED`, `DISPUTE_OPENED`, `DISPUTE_DECIDED`, `REVIEW_CREATED`); texto fixo, sem conteúdo; profissional sem conta ⇒ descarta |
| `consultations.purge-expired` | diário, `55 3 * * *` (03:55 UTC) | apaga os ficheiros de comprovativos de marcações com `startsAt` há mais de 24 meses (ver «Ciclo de vida»); idempotente; auditoria `PROOF_FILES_PURGED` só com a contagem |

## Portas e onde são implementadas

| Porta (`application/ports.ts`) | Implementação | Ligação |
|---|---|---|
| `BookingAccess` | `access.policy.can(..., "BOOK_PROFESSIONALS")` | `main/api.ts` |
| `ProfessionalAgenda` | `professionals.directory` (`getBookingFacts`, `reserveSlot`/`releaseSlot`, `getApprovedProfile`, `listBookableSlots`, `readPaymentInstructions`, `getConversationIdentities`, `findSpecialties`) | `main/api.ts` |
| `SelfDealingGuard` | `createSelfDealingGuard` (e-mails normalizados de `professionals` e `users`) | `main/api.ts` |
| `ProcessLinker` | `processes.linker.open` (`Process` `BOOKING`, idempotente) | `main/api.ts` |
| `FamilyAppointmentWriter` | `appointments.familyAppointmentWriter` (no worker, só `syncFromBooking`) | `main/api.ts`, `main/worker.ts` |
| `ConversationLookup` | `messaging.lookup` (derivada, OP-106) | `main/api.ts` |
| `BookingAlerts` | `alerts.raiseBookingEvent` (`BOOKING_UPDATED`, `PAYMENT_UPDATED`) | `main/api.ts`, `main/worker.ts` |
| `ProfessionalNotices` | `PgBossProfessionalNotices` | `main/api.ts` |
| `ProfessionalContact` e `ProfessionalMailer` | `professionals.notificationEmail` e `SmtpProfessionalNoticeMailer` | `main/worker.ts` |
| `ProofScanner` | `ProofClamAvScanner` (`infrastructure/clamav-client.ts`) | `main/worker.ts` |
| `ProofScanQueue` | `PgBossProofScanQueue` | `main/api.ts`, `main/worker.ts` |
| `ProofFileStore` | `StorageProofFileStore` (`infrastructure/storage-file-store.ts`, sobre `platform/storage`) | interna ao módulo |
| `ReviewStats` (porta de `discovery`) | implementada por `consultations` (`reviewStats`) | `main/api.ts` |
| `ProcessFacts` (`originType=BOOKING`) | `getActFacts` | `main/api.ts` |
| Fonte `bookings` da exportação | `reads.bookings` | `main/api.ts` (`lifecycle`) |

## Ciclo de vida e retenção

- **Cascatas por FK (migração `0045`):** `bookings` cai com o membro (`family_members (family_id, id)`, CASCADE) e com o profissional (CASCADE); as FK da oferta e do horário são `NO ACTION` (a cascata do profissional não as viola); `specialties` é RESTRICT; `users` é SET NULL (só autoria).
- **Comprovativos:** `payment_proofs` cai com a marcação (CASCADE). O trigger `payment_proofs_enqueue_file_trg` (AFTER DELETE) põe a `storage_key` na outbox `consultation_file_deletions` se `purged_at IS NULL`, por isso o ficheiro é apagado também nas cascatas (OP-99). A outbox não tem FK e sobrevive à eliminação; o job `delete-files` esvazia-a.
- **Avaliações:** `reviews` são anónimas (sem família, membro nem utilizador); `reviews.booking_id` é SET NULL. O trigger `bookings_clear_review_comment_trg` (BEFORE DELETE) limpa o `comment` da avaliação quando a marcação é apagada (BR-MKT-64). `review_reports` cai com a avaliação.
- **Imutabilidade:** `bookings_snapshot_immutable_trg` impede alterar preço, duração, método, especialidade, início, fim e `created_at`.
- **Horário:** `professional_slots.booking_id` é UNIQUE, FK SET NULL, `DEFERRABLE INITIALLY DEFERRED`; `appointments.booking_id` é SET NULL.
- **Retenção de ficheiros (BR-MKT-64):** `PROOF_RETENTION_MONTHS = 24`, sobre `startsAt`. O job `purge-expired` marca `purged_at` e envia o ficheiro para a outbox. Os metadados do comprovativo, a marcação e a avaliação mantêm-se.

## Privacidade

- Texto livre (`participantLabel`, `statusReason`, `meetingInfo`, notas de disputa e de decisão, `comment`, resposta) nunca vai para logs, auditoria, alertas nem e-mails (BR-MKT-63/65). Os erros de validação não repetem o texto recebido.
- Alertas à família e avisos ao profissional são genéricos (versão do estado, texto fixo, sem ids nem nomes).
- `storageKey` não sai da `application` nas vistas; o ficheiro só é descarregado pelas rotas auditadas.
- Admin: vê o comprovativo e os factos da marcação (oferta, datas, preço, estados), mas nunca família, membro nem `participantLabel` (`DisputeRow`).
- Profissional: só vê marcações com o seu `professionalId`; não vê ids de família nem de membro.
- Tipo de ficheiro validado pela assinatura dos primeiros bytes, nunca pela extensão nem pelo `Content-Type` declarado.

## Fronteiras (testes `tests/consultations-architecture.test.ts`, TC-MKT-108)

`consultations` só importa o próprio módulo, `platform/*` e a raiz de `audit`; nenhum módulo importa `consultations` (só `main/`); `professionals` e `discovery` não o importam (`discovery` só tem a porta `ReviewStats`); `domain/` não importa nada fora de `domain/`, não usa pacotes nem `Date`/`Math.random`; `application/` não importa express, kysely, pg, pg-boss nem nodemailer.

## Testes

- `tests/consultations-architecture.test.ts`: fronteiras (acima).
- `tests/integration/consultations-*.integration.test.ts` (PostgreSQL real): `constraints`, `family-create`, `family-access`, `professional`, `professional-access`, `proofs`, `disputes`, `reviews`, `notifications`, `lifecycle`.
- Testes unitários junto ao código: `domain/*.test.ts` (booking, payment, projection, text, file-type), `application/*.test.ts` (cursor, rate-limiter, self-dealing), `infrastructure/clamav-client.test.ts`.
