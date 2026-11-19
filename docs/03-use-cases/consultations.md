# Casos de uso — Marcação, comprovativo de pagamento e avaliações verificadas (MK3, ADR-037)

> Estado: **v0.1 — contrato de MK3 (2026-11-19); nada implementado.** Convenções comuns em `family.md`; profissionais (MK1) em `professionals.md`; descoberta e conversas (MK2) em `marketplace.md`. Regras: `business-rules.md` §17 (BR-MKT-50..66); requisitos FR-MKT-23..36. Atores: **Família** (`User`; marca, paga e avalia como titular `SELF` ou tutor `TUTOR_OF` em nome do dependente), **Profissional** (`ProfessionalAccount`, portal), **Platform Admin**, **Sistema** (jobs). **Fora de MK3:** receita digital e partilha de registos (MK4), pagamento dentro da app, reembolsos. Texto livre de MK3 (rótulo, motivos, notas, ligação, comentários) é dado potencialmente sensível (BR-MKT-63): nunca em logs nem auditoria.

## Marcar (família)

### UC-MKT-26 Ver horários livres de um profissional
- **Ator:** família (User autenticado) · **FR:** MKT-23 · **BR:** MKT-53, MKT-32 · **Rota:** `GET /marketplace/professionals/{professionalId}/slots` (sem `AccessPolicy`: dados públicos).
- **Fluxo:** no perfil (UC-MKT-14), com uma oferta escolhida, a família vê os horários futuros **livres** dessa oferta (próximos 62 dias no máximo; `from`/`to` opcionais) → escolhe um.
- **Alternativos:** profissional inexistente ou não `APPROVED` ⇒ `NOT_FOUND`; oferta inativa ou de outro profissional ⇒ lista vazia/`NOT_FOUND`; intervalo inválido ⇒ `VALIDATION_ERROR`; sem sessão ou token de profissional ⇒ `401`; excesso ⇒ `RATE_LIMITED`.
- **Pós-condição:** nada gravado. Os horários ocupados nunca aparecem; um horário pode ser perdido entre ver e marcar (UC-MKT-27).

### UC-MKT-27 Marcar uma consulta
- **Ator:** `SELF` ou `TUTOR_OF` do membro · **FR:** MKT-23, MKT-26, MKT-33 · **BR:** MKT-50, MKT-51, MKT-53, MKT-55, MKT-62, MKT-65 · **Rota:** `POST /families/{f}/members/{m}/bookings`.
- **Fluxo:** a família escolhe o membro, a oferta e o horário → lê o **aviso da categoria** (BR-MKT-02), o **preço em Kz** e a antecedência → indica o rótulo do participante (1–40; sugestão: o primeiro nome) → **Marcar**. Numa só transação: factos da oferta/horário → guarda `SelfDealingGuard` (depois dos factos, precisa do `professionalId`; OP-113) → antecedência e limites → **reserva atómica do horário** → grava a marcação `REQUESTED` com preço copiado → abre o `Process` `BOOKING` → auditoria `BOOKING_CREATE` → aviso ao profissional. A família vê «A aguardar resposta do profissional».
- **Alternativos:** profissional, oferta ou horário inexistente ou profissional não `APPROVED` ⇒ `NOT_FOUND`; horário que não é da oferta, antecedência < 2 h ou fora das 8 semanas ⇒ `VALIDATION_ERROR`; horário já ocupado (inclui corrida) ⇒ `SLOT_UNAVAILABLE`; o membro tem marcação ativa sobreposta ⇒ `CONFLICT`; 10 ativas ou 10 criações/dia ⇒ `LIMIT_EXCEEDED`/`RATE_LIMITED`; utilizador com o mesmo e-mail do profissional ⇒ `SELF_BOOKING_NOT_ALLOWED` (só se profissional `APPROVED`, oferta ativa e horário existirem; senão `NOT_FOUND`); `DEPENDENT_SELF`/`OTHER` ⇒ `FORBIDDEN`; membro `BLOCKED` ⇒ `MEMBER_BLOCKED`; repetir com o mesmo `clientRequestId` ⇒ `200` com a marcação existente.
- **Pós-condição:** marcação `REQUESTED`, `paymentStatus=AWAITING_PROOF` (ou `NOT_REQUIRED` se 0 Kz), `slot.booking_id` preenchido, `Process` aberto; **sem motivo em texto livre** (BR-MKT-51). Ainda **não** há consulta no registo (só ao confirmar).

### UC-MKT-28 Ver as marcações do membro
- **Ator:** `SELF`/`TUTOR_OF` · **FR:** MKT-24, MKT-26 · **BR:** MKT-50, MKT-55, MKT-56 · **Rotas:** `GET /families/{f}/members/{m}/bookings`, `…/bookings/{bookingId}`.
- **Fluxo:** a lista mostra as marcações (filtro `status`, mais recentes primeiro) com profissional (nome público e cidade), oferta, hora, preço, estado, estado do pagamento e **o que falta** (do processo); o detalhe acrescenta, **só se `CONFIRMED`/`COMPLETED`**, a ligação/número (`meetingInfo`) e, com preço > 0, as **instruções de pagamento** do profissional, e indica se pode cancelar, enviar comprovativo ou avaliar (`canCancel`, `canSendProof`, `canReview`), e a conversa com o profissional se existir (`conversationId`).
- **Alternativos:** marcação de outro membro/família ou inexistente ⇒ `NOT_FOUND`; relação insuficiente ⇒ `FORBIDDEN`.
- **Pós-condição:** nada gravado nem auditado. O processo aparece também em **Processos** (UC-PRC-03) e, depois de confirmada, a consulta em **Consultas**.

### UC-MKT-29 Cancelar uma marcação (família)
- **Ator:** `SELF`/`TUTOR_OF` · **FR:** MKT-24 · **BR:** MKT-52, MKT-53, MKT-55, MKT-65 · **Rota:** `POST …/bookings/{bookingId}/cancel` (`note?` ≤ 300).
- **Fluxo:** a UI mostra quanto tempo falta até à hora (e se o cancelamento é «em cima da hora», < 24 h; só informativo) → confirma → `REQUESTED`/`CONFIRMED` → `CANCELLED` (`cancelledBy=FAMILY`), horário libertado, consulta gerada (se existir) → `CANCELLED`, aviso ao profissional, auditoria `BOOKING_CANCEL`.
- **Alternativos:** já terminal ou com a hora passada ⇒ `INVALID_STATE_TRANSITION`; marcação alheia ⇒ `NOT_FOUND`.
- **Pós-condição:** pagamento congelado no estado em que estava (reembolsos fora da app, BR-MKT-56).

## Atender (profissional)

### UC-MKT-30 Ver as marcações
- **Ator:** profissional · **FR:** MKT-25 · **BR:** MKT-50, MKT-63 · **Rotas:** `GET /professional-portal/bookings`, `…/{bookingId}` (todos os estados de validação, só leitura).
- **Fluxo:** lista filtrável por `status` e por intervalo de datas (omissão: `REQUESTED` e `CONFIRMED` futuras), com rótulo do participante, oferta, hora, preço, estados, e o resumo do comprovativo; o detalhe mostra o `reason`/`note` do outro lado e o comprovativo em curso.
- **Alternativos:** marcação de outro profissional ⇒ `NOT_FOUND` idêntico.
- **Pós-condição:** nunca ids de família, membro nem utilizador (TC-AZ-MKT-21).

### UC-MKT-31 Confirmar ou recusar um pedido
- **Ator:** profissional `APPROVED` · **FR:** MKT-25, MKT-26 · **BR:** MKT-52, MKT-54, MKT-55, MKT-65 · **Rotas:** `POST …/bookings/{bookingId}/confirm` (`meetingInfo?`), `…/reject` (`reason`).
- **Fluxo (confirmar):** `REQUESTED` → `CONFIRMED`; em `VIDEO`/`PHONE` indica a ligação ou o número a ligar (obrigatório); na mesma transação cria a **consulta** no membro (`FamilyAppointmentWriter`) e envia alerta `BOOKING_UPDATED` à família; auditoria. **Fluxo (recusar):** `REQUESTED` → `REJECTED` com motivo, horário libertado, alerta à família.
- **Alternativos:** não `APPROVED` ⇒ `PROFESSIONAL_LOCKED`; já decidida/cancelada, ou `REQUESTED` já expirado (BR-MKT-54, mesmo que o job ainda não a tenha cancelado) ⇒ `INVALID_STATE_TRANSITION`; `meetingInfo` em falta em vídeo/telefone ⇒ `VALIDATION_ERROR`; marcação alheia ⇒ `NOT_FOUND`.
- **Pós-condição:** estados e consulta coerentes na mesma transação; a família vê as instruções de pagamento (se preço > 0).

### UC-MKT-32 Cancelar uma marcação (profissional)
- **Ator:** profissional `APPROVED` · **BR:** MKT-52, MKT-53, MKT-65 · **Rota:** `POST …/bookings/{bookingId}/cancel` (`reason` obrigatório).
- **Fluxo:** `REQUESTED`/`CONFIRMED` antes da hora → `CANCELLED` (`cancelledBy=PROFESSIONAL`), horário libertado, consulta → `CANCELLED`, alerta à família com o motivo visível na marcação.
- **Alternativos:** hora passada ⇒ `INVALID_STATE_TRANSITION` (usa-se concluir/falta); sem motivo ⇒ `VALIDATION_ERROR`; não `APPROVED` ⇒ `PROFESSIONAL_LOCKED`.

### UC-MKT-33 Concluir a consulta ou marcar falta
- **Ator:** profissional `APPROVED` · **FR:** MKT-25 · **BR:** MKT-52, MKT-55, MKT-59 · **Rotas:** `POST …/bookings/{bookingId}/complete`, `…/no-show`.
- **Fluxo:** com `agora ≥ startsAt`, `CONFIRMED` → `COMPLETED` (grava `completedAt`) ou `NO_SHOW`; a consulta no registo da família passa a `COMPLETED`/`NO_SHOW` na mesma transação; o processo passa a «Feito»/«Cancelado — voltar a marcar»; se o pagamento está em falta o processo mostra «o que falta» (UC-MKT-35/36).
- **Alternativos:** antes da hora ou estado diferente de `CONFIRMED` ⇒ `INVALID_STATE_TRANSITION`; terminal sem correção (OP-108).
- **Pós-condição:** `COMPLETED` + pagamento satisfeito abre a janela de avaliação de 30 dias (UC-MKT-39).

### UC-MKT-34 Expirar pedidos e cancelar por indisponibilidade (sistema)
- **Ator:** sistema (job `consultations.reconcile-bookings`, de 5 em 5 min) · **BR:** MKT-54, MKT-01, MKT-21 · **FR:** MKT-27.
- **Fluxo:** (a) `REQUESTED` sem resposta há 48 h ou com a hora já passada → `CANCELLED` (`SYSTEM`, `REQUEST_EXPIRED`); (b) marcação futura `REQUESTED`/`CONFIRMED` de um profissional que deixou de estar `APPROVED` → `CANCELLED` (`SYSTEM`, `PROFESSIONAL_UNAVAILABLE`); em ambos: horário libertado, consulta → `CANCELLED`, alerta `BOOKING_UPDATED` à família, auditoria `BOOKING_AUTO_CANCEL` (sem motivo livre).
- **Alternativos:** execução repetida ⇒ idempotente (só atua sobre estados ativos); marcações **passadas** `CONFIRMED` de um não `APPROVED` não se tocam (OP-97); reativação não repõe.
- **Pós-condição:** nenhuma marcação futura fica ativa com um profissional invisível (≤ 5 min); entretanto o profissional não-`APPROVED` não confirma nem conclui.

## Pagar e confirmar (comprovativo, fora da app)

### UC-MKT-35 Ver as instruções e carregar o comprovativo
- **Ator:** `SELF`/`TUTOR_OF` · **FR:** MKT-28 · **BR:** MKT-56, MKT-57, MKT-63 · **Rotas:** `GET …/bookings/{bookingId}` (instruções), `POST …/payment-proofs` (multipart), `GET …/payment-proofs`, `GET …/payment-proofs/{proofId}/file`.
- **Fluxo:** com a marcação `CONFIRMED` (ou `COMPLETED`) e preço > 0, a família lê as instruções (IBAN, referência, telemóvel… texto do profissional), **paga fora da app** e carrega o ficheiro (PDF/JPG/PNG ≤ 10 MB) → quarentena e antivírus (`PENDING` → `CLEAN`) → comprovativo `SUBMITTED`, `paymentStatus=PROOF_SUBMITTED`, aviso ao profissional, auditoria `PAYMENT_PROOF_UPLOAD`. Pode descarregar os seus próprios comprovativos (auditado).
- **Alternativos:** preço 0 ⇒ `INVALID_STATE_TRANSITION` (`NOT_REQUIRED`); marcação `REQUESTED`/`CANCELLED`/`REJECTED`/`NO_SHOW` ⇒ `INVALID_STATE_TRANSITION`; já há comprovativo em curso ou 5 enviados ⇒ `LIMIT_EXCEEDED`/`CONFLICT`; ficheiro > 10 MB ⇒ `FILE_TOO_LARGE`; tipo ⇒ `FILE_TYPE_NOT_ALLOWED`; infetado ⇒ nunca descarregável (`DOCUMENT_NOT_AVAILABLE`); `RATE_LIMITED` (20/h).
- **Pós-condição:** o Vita **não** confirma que o dinheiro existe; o estado é declarativo (BR-MKT-56).

### UC-MKT-36 Decidir o comprovativo (profissional)
- **Ator:** profissional `APPROVED` · **FR:** MKT-29 · **BR:** MKT-57, MKT-58, MKT-65 · **Rotas:** `GET /professional-portal/bookings/{bookingId}/payment-proofs/{proofId}/file`, `POST …/decision` (`CONFIRM` | `REJECT` + `reason`).
- **Fluxo:** o profissional descarrega o ficheiro (`CLEAN`; auditado) → **confirma** (`paymentStatus=CONFIRMED`) ou **rejeita** com motivo (`REJECTED`; a família é avisada e pode carregar outro ou disputar) → alerta `PAYMENT_UPDATED`, auditoria `PROFESSIONAL_PAYMENT_PROOF_DECIDE` (`metadata.decision`).
- **Alternativos:** comprovativo já decidido ⇒ `INVALID_STATE_TRANSITION`; ainda em antivírus/infetado ⇒ `DOCUMENT_NOT_AVAILABLE`; sem motivo na rejeição ⇒ `VALIDATION_ERROR`; não `APPROVED` ⇒ `PROFESSIONAL_LOCKED`; comprovativo de outra marcação/profissional ⇒ `NOT_FOUND`.

### UC-MKT-37 Disputar uma rejeição (família)
- **Ator:** `SELF`/`TUTOR_OF` · **FR:** MKT-29 · **BR:** MKT-58 · **Rota:** `POST …/payment-proofs/{proofId}/dispute` (`note` ≤ 300).
- **Fluxo:** o comprovativo `REJECTED` → `DISPUTED`, `paymentStatus=DISPUTED`, entra na fila do admin; auditoria `PAYMENT_PROOF_DISPUTE`.
- **Alternativos:** comprovativo que não está `REJECTED`, ou já disputado antes ⇒ `INVALID_STATE_TRANSITION`.

### UC-MKT-38 Resolver uma disputa (admin)
- **Ator:** Platform Admin · **FR:** MKT-29 · **BR:** MKT-58, MKT-63 · **Rotas:** `GET /admin/payment-disputes`, `…/{proofId}`, `…/{proofId}/file`, `POST …/{proofId}/decisions` (`CONFIRM_PAYMENT` | `UPHOLD_REJECTION`).
- **Fluxo:** **Administração → Disputas de pagamento** (fila `DISPUTED`, mais antigas primeiro; a lista não mostra ficheiros) → abre o detalhe (**a marcação** — profissional pelo nome público, especialidade, método, hora, preço, estados, motivo do profissional e nota da família — e **o comprovativo**, que descarrega por rota própria) — cada abertura e cada descarregamento são **auditados** → decide.
- **Alternativos:** disputa já decidida ⇒ `INVALID_STATE_TRANSITION`; não-admin ⇒ `FORBIDDEN`; token de profissional ⇒ `401`; inexistente ⇒ `NOT_FOUND`.
- **Pós-condição:** transação com bloqueio; `CONFIRM_PAYMENT` ⇒ comprovativo `CONFIRMED`, `paymentStatus=CONFIRMED`; `UPHOLD_REJECTION` ⇒ `REJECTION_UPHELD`, `paymentStatus=REJECTED`; alerta `PAYMENT_UPDATED` à família e e-mail ao profissional; auditoria `ADMIN_PAYMENT_DISPUTE_DECIDE`. O admin **não** vê família, membro, rótulo nem conversas.

## Avaliar

### UC-MKT-39 Avaliar o profissional (criar/editar)
- **Ator:** `SELF`/`TUTOR_OF` · **FR:** MKT-30, MKT-33 · **BR:** MKT-59, MKT-62 · **Rotas:** `GET …/bookings/{bookingId}/review`, `PUT …/bookings/{bookingId}/review` (`rating` 1–5, `comment?` ≤ 500).
- **Fluxo:** com a marcação `COMPLETED` e pagamento `CONFIRMED`/`NOT_REQUIRED`, dentro de 30 dias, a família dá a nota e um comentário curto (aviso: «Não escreva dados de saúde.»; «a sua avaliação é anónima») → `201`; pode **editar** até 7 dias depois (`200`).
- **Alternativos:** marcação não concluída, `NO_SHOW`, pagamento por satisfazer, fora de 30 dias ou edição após 7 dias ⇒ `REVIEW_NOT_ALLOWED`; mesmo e-mail do profissional ⇒ `SELF_BOOKING_NOT_ALLOWED`; `DEPENDENT_SELF`/`OTHER` ⇒ `FORBIDDEN`; comentário > 500/controlo ⇒ `VALIDATION_ERROR`; `RATE_LIMITED`.
- **Pós-condição:** uma avaliação por marcação (UNIQUE); sem nome nem data exata; auditoria `REVIEW_CREATE`/`REVIEW_UPDATE` sem texto; aviso ao profissional.

### UC-MKT-40 Ver as avaliações de um profissional
- **Ator:** família (User autenticado) · **FR:** MKT-30, MKT-32 · **BR:** MKT-59, MKT-60 · **Rota:** `GET /marketplace/professionals/{professionalId}/reviews` (`specialtyId?`, `limit`, `cursor`).
- **Fluxo:** no perfil, a família vê o resumo (`reviewSummary`: nº e média, esta só com ≥ 3) e a lista, mais recentes primeiro: nota, comentário (ou «Comentário ocultado pela moderação»), mês da consulta, especialidade, método e a resposta do profissional.
- **Alternativos:** profissional inexistente/não `APPROVED` ⇒ `NOT_FOUND`; sem avaliações ⇒ `items: []` («Novo»).
- **Pós-condição:** nada gravado; **nunca** ids, nomes nem a data exata.

### UC-MKT-41 Responder a uma avaliação (profissional)
- **Ator:** profissional `APPROVED` · **FR:** MKT-31 · **BR:** MKT-60 · **Rotas:** `GET /professional-portal/reviews`, `POST …/reviews/{reviewId}/reply` (`text` 1–500).
- **Fluxo:** vê as suas avaliações (as mais recentes; as sem resposta marcadas) e responde **uma vez** → a resposta fica pública junto da avaliação; aviso ao autor não existe (anónima); auditoria `PROFESSIONAL_REVIEW_REPLY` sem texto.
- **Alternativos:** já respondeu ⇒ `CONFLICT`; avaliação de outro profissional ⇒ `NOT_FOUND`; não `APPROVED` ⇒ `PROFESSIONAL_LOCKED`.

### UC-MKT-42 Denunciar uma avaliação (profissional)
- **Ator:** profissional `APPROVED` · **FR:** MKT-31 · **BR:** MKT-60 · **Rota:** `POST /professional-portal/reviews/{reviewId}/reports` (`reason`, `note?` ≤ 300).
- **Fluxo:** a avaliação continua visível; a denúncia entra na fila do admin; auditoria `PROFESSIONAL_REVIEW_REPORT_CREATE` (`metadata.reason`).
- **Alternativos:** já denunciada antes ⇒ `200` com a existente; avaliação alheia ⇒ `NOT_FOUND`; `RATE_LIMITED` (10/dia).

### UC-MKT-43 Moderar uma denúncia de avaliação (admin)
- **Ator:** Platform Admin · **FR:** MKT-31 · **BR:** MKT-60, MKT-63 · **Rotas:** `GET /admin/review-reports`, `…/{reportId}`, `POST …/{reportId}/decisions` (`DISMISS` | `HIDE_COMMENT`).
- **Fluxo:** **Administração → Denúncias de avaliações** (fila `OPEN`) → detalhe (nota, comentário, resposta, mês, especialidade, método, profissional pelo nome público, motivo/nota) — **auditado** → arquiva ou **oculta o comentário** (a nota continua a contar; o admin não mexe no ranking).
- **Alternativos:** denúncia decidida ⇒ `INVALID_STATE_TRANSITION`; não-admin ⇒ `FORBIDDEN`.
- **Pós-condição:** transação com bloqueio; `reviews.comment_hidden_at` e auditoria `ADMIN_REVIEW_REPORT_DECIDE` (sem texto). O admin não vê família, membro, marcação nem outras avaliações.

## Ranking e ciclo de vida

### UC-MKT-44 Pesquisar com o ranking `v2` (leitura)
- **Ator:** família · **FR:** MKT-32 · **BR:** MKT-61, MKT-36 · **Rotas:** as de UC-MKT-13/14/16 (`searchProfessionals`, `getMarketplaceProfessional`, `getRankingRules`), com `ranking.version=v2`, `label` `NEW`/`RATED`, sinal `reviews` e `reviewSummary`.
- **Fluxo:** a ordenação «Melhores» (com especialidade) usa os cinco sinais; com menos de 3 avaliações o cartão mostra **«Novo»**; «Como ordenamos» passa a listar «Avaliações de quem consultou» com o peso; as razões incluem «Bem avaliado».
- **Alternativos:** como UC-MKT-13. **Pós-condição:** nada gravado; pagamento, destaques e ordem manual continuam **sem efeito** (teste metamórfico).

### UC-MKT-45 Bloquear horários com marcações (profissional, extensão de UC-MKT-09)
- **Ator:** profissional · **BR:** MKT-53 · **Rota:** `POST /professional-portal/time-off` (existente).
- **Fluxo:** criar um bloqueio que cubra horários **livres** remove-os (MK1); se cobrir um horário com marcação `REQUESTED`/`CONFIRMED` futura ⇒ `409 CONFLICT` (`detail` com o número de marcações; sem dados da família) → o profissional recusa/cancela essas marcações (UC-MKT-31/32) e repete.
- **Alternativos:** bloqueio sem marcações ⇒ comportamento de MK1.

### UC-MKT-46 Expurgar ficheiros de comprovativos pela retenção (sistema)
- **Ator:** sistema (job `consultations.purge-expired`, diário) · **BR:** MKT-64.
- **Fluxo:** comprovativos de marcações com `startsAt` há mais de 24 meses → o ficheiro apaga-se por outbox (`consultation_file_deletions`) e o registo fica sem ficheiro (`purged_at`); auditoria `PROOF_FILES_PURGED` (`actor_type=SYSTEM`, `metadata.count`).
- **Alternativos:** repetição ⇒ idempotente; avaliações e marcações não se tocam.

### UC-MKT-47 Exportar e apagar as marcações do membro (ciclo de vida)
- **Ator:** titular (exportação/saída com pacote) ou apagamento do membro/família · **FR:** MKT-34 · **BR:** MKT-64.
- **Fluxo:** a exportação inclui a fonte opcional `bookings`; apagar o membro/família apaga marcações, comprovativos (ficheiros por outbox via trigger), liberta horários e **anonimiza** a avaliação (nota e resposta ficam; o comentário é removido); o `Process` e a consulta gerada apagam-se com o membro.
- **Alternativos:** profissional apagado ⇒ apaga marcações, comprovativos e avaliações; consultas do registo ficam como consultas normais (OP-64).

## Efeitos noutros fluxos
- **MK1:** criar bloqueios, desativar regras/ofertas e regenerar horários respeitam horários ocupados (BR-MKT-53); `GET /professional-portal/slots` mostra `booked`; a suspensão/caducidade passa a cancelar marcações futuras (BR-MKT-54, resolve OP-63/OP-67 nas marcações).
- **MK2:** a pesquisa e o ranking passam a `v2`; `slotStats`/`availableWithinDays` excluem horários ocupados; a conversa **não** muda (a ligação marcação↔conversa é derivada pelo par membro+profissional, OP-106).
- **`appointments`:** a consulta gerada por uma marcação é gerida pela marcação (BR-MKT-55). **`processes`:** nova origem `BOOKING` (4 estados + «o que falta»). **`alerts`:** `BOOKING_UPDATED`, `PAYMENT_UPDATED`. **MK4:** a partilha com prazo poderá ligar-se à marcação; a receita digital (após parecer) exigirá marcação `COMPLETED`.
