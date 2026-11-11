# Vita Family — Casos de teste (Fase 15)

> Estado: **v0.1**. Catálogo (não exaustivo) dos casos que devem existir antes do M10. Nível: **U** unitário, **I** integração, **A** API/E2E, **S** segurança, **L** carga. Cada caso liga a critérios (`AC-*`) e requisitos.

## 1. Autenticação e conta (TC-AUTH)
| ID | Caso | Nível | Liga a |
|---|---|---|---|
| TC-AUTH-01 | Registo válido; e-mail de verificação; login só após verificar | A | AC-ACC-01 |
| TC-AUTH-02 | Registo com <18 anos recusado; dependente via convite com ≥13 aceite, <13 recusado | A | AC-ACC-02, AC-MEM-05 |
| TC-AUTH-03 | Registo de e-mail existente devolve resposta idêntica (tempo e corpo) | S | AC-ACC-03 |
| TC-AUTH-04 | Política de palavra-passe (11 caracteres falha, comum falha, 12 válida) | U | NFR-SEC-03 |
| TC-AUTH-05 | Login: credenciais inválidas genérico; conta não verificada; suspensa | A | AC-ACC-04 |
| TC-AUTH-06 | Rate limit de login (5 falhas/15 min) e de registo/recuperação | S | NFR-SEC-05 |
| TC-AUTH-07 | Refresh rotativo; reutilização revoga a cadeia | S | AC-ACC-07 |
| TC-AUTH-08 | Access token expirado ⇒ `TOKEN_EXPIRED`; sem papéis no token | A | ADR-007 |
| TC-AUTH-09 | Recuperação: token de uso único, 1 h, revoga sessões | A | UC-ACC-03 |
| TC-AUTH-10 | Reaceitação de termos bloqueia API exceto 3 operações | A | AC-ACC-06 |
| TC-AUTH-11 | Eliminação de conta bloqueada (único tutor / único Admin) e permitida depois | A | AC-ACC-05 |
| TC-AUTH-12 | Mudança de fuso recalcula tomas futuras | I | AC-MED-05 |

> **Nota M6 (change control, ver `apps/api/src/modules/medications/README.md`):** TC-AUTH-12 pressupõe um gatilho *imediato* de `users.updateMe` para `medications`, que exigiria `users` → `medications` e fecharia um ciclo (`medications` → `access` → `families` → `users`). Implementado em vez disso: o job diário `medications.generate-doses` relê o fuso efetivo a cada corrida (latência ≤24h). O caso unitário equivalente (`generateDosesJob` recalcula sem duplicar/perder) está em `medications/application/generate-doses-job.test.ts`; a versão *imediata* de TC-AUTH-12 fica pendente de decisão do proprietário.

## 2. Autorização e isolamento (TC-AZ) — **gerados da matriz**
| ID | Caso | Nível |
|---|---|---|
| TC-AZ-MATRIX | Para cada relação (SELF, TUTOR_OF, DEPENDENT_SELF, OTHER, Admin-como-OTHER, PLATFORM_ADMIN) × categoria (5) × ação (ler/criar/editar/eliminar/confirmar) o resultado esperado de `authorization.md` §3 | U + A |
| TC-AZ-ISO | Percorrer **todos** os endpoints com `familyId`: utilizador de outra família ⇒ 404 | A + S |
| TC-AZ-IDOR | Trocar `memberId`/`recordId` por id de outra família ou outro membro (mesmo com família correta) ⇒ 404 | S |
| TC-AZ-SHARE | Partilha por categoria e "toda a família"; retirada com efeito imediato; só leitura | A |
| TC-AZ-ADMIN | Family Admin sem partilha não lê saúde de outro adulto | A |
| TC-AZ-DEP | Dependente com conta: permitido (medicação, consultas, confirmar toma), negado (resto) | A |
| TC-AZ-PLAT | Platform Admin negado em todos os endpoints de saúde; imports do módulo `admin` verificados | A + arquitetura |
| TC-AZ-SUSP | Suspender conta corta acesso em ≤60 s | A |
| TC-AZ-POLICY-CALLED | Rota de negócio sem decisão de policy registada falha o teste | I |

## 3. Família, membros, tutela, convites (TC-FAM)
| ID | Caso | Nível | Liga a |
|---|---|---|---|
| TC-FAM-01 | Criar família ⇒ Admin; limite de 5 famílias | A | AC-FAM-01/02 |
| TC-FAM-02 | Último Admin não sai/perde papel; transferência exige adulto com conta | A | AC-FAM-03 |
| TC-FAM-03 | Eliminar família: recusa com >1 membro; apaga tudo com 1 | A + I | AC-FAM-04 |
| TC-FAM-04 | Constraint: um tutor principal por dependente; sem auto-tutela | I | BR-MEM-06 |
| TC-FAM-05 | Menor ⇒ dependente obrigatório; tutor adulto com conta da mesma família | U + A | AC-MEM-02 |
| TC-FAM-06 | Convite: 7 dias, uso único, e-mail coincide, limite 20 pendentes | A | AC-MEM-03 |
| TC-FAM-07 | Convite ligado a perfil: `BIRTHDATE_MISMATCH` | A | AC-MEM-04 |
| TC-FAM-08 | Sair/remover: pacote gerado antes do apagamento (TAKE e remoção por Admin) | A + I | AC-MEM-06/07 |
| TC-FAM-09 | Maioridade: avisos 30/7/0 dias, fim da tutela, perda de acesso do tutor, partilha mantida | I (relógio) | AC-MEM-08 |
| TC-FAM-10 | Menor sem conta aos 18: BLOCKED, avisos 0/30/60/83, apagado aos 90 | I (relógio) | AC-MEM-09 |
| TC-FAM-11 | Limites: 20 membros, 10 clínicas privadas | A | BR-FAM-07 |

## 4. Registos de saúde (TC-HLT)
| ID | Caso | Nível |
|---|---|---|
| TC-HLT-01 | CRUD de alergia/condição/tipo sanguíneo; auditoria sem versionamento | A |
| TC-HLT-02 | Validações: datas plausíveis, `until ≥ since`, enums | U |
| TC-RX-01 | Receita cria planos e ocorrências (14 dias) | I |
| TC-RX-02 | Receita inválida (sem data, data futura, sem medicamentos) | A |
| TC-RX-03 | Concluir/cancelar/reabrir receita e planos (ST1) | A |
| TC-RX-04 | Eliminar receita apaga planos, tomas e ficheiros | I |
| TC-MED-01 | Geração FIXED_TIMES (dias da semana) e INTERVAL | U |
| TC-MED-02 | **DST:** hora inexistente (março) e repetida (outubro) em Europe/Lisbon | U |
| TC-MED-03 | Janela de toma: PENDING→UNCONFIRMED às 2 h; confirmação tardia até ao fim do dia seguinte; correção até 7 dias; futuro >1 h recusado | U + A |
| TC-MED-04 | Confirmação idempotente; regista quem e quando; D sem conta confirmada por T | A |
| TC-MED-05 | Editar plano só afeta futuro; passado preservado | I |
| TC-MED-06 | Adesão: contagens por estado | I |
| TC-APT-01 | Criar/editar/cancelar/reagendar; lembretes 24 h e 2 h recalculados | I |
| TC-APT-02 | Consulta passada permanece SCHEDULED; pedido de desfecho 24 h depois, uma vez | I |
| TC-APT-03 | Transições de estado válidas e inválidas (ST4) | U |
| TC-CLN-01 | Clínicas privadas/parceiras: visibilidade, arquivo, nome preservado em consultas | A |
| TC-EXM-01 | Exame futuro/passado (ST5); resultados só em COMPLETED; valores numérico/texto (Q9) | A |
| TC-EXM-02 | Valor fora do intervalo informado não gera alerta nem marca | A |
| TC-EXM-03 | Histórico de um parâmetro ordenado por data | A |
| TC-EXM-04 | Marcar em horário `EXAM`: nasce SCHEDULED com lembrete; `capacity` N ⇒ N marcações, a N+1 ⇒ CONFLICT; mesmo membro 2× ⇒ CONFLICT; `kind` trocado ⇒ VALIDATION_ERROR (BR-APT-10/11) (AC-EXM-03) | A |
| TC-EXM-05 | Transições SCHEDULED→CANCELLED/COMPLETED; CANCELLED com `slotId` não reagenda (BR-EXM-08); valores `REQUESTED`/`REJECTED` rejeitados pela CHECK e inexistentes na API (AC-EXM-03/04) | U + I |
| TC-EXM-06 | Clínica: lista horários com ocupação, `PATCH` de `capacity` (abaixo das marcações ⇒ CONFLICT; em APPOINTMENT ⇒ VALIDATION_ERROR), remove horário com marcações ⇒ CONFLICT, cancela marcação (motivo obrigatório, vaga libertada, `EXAM_CANCELLED`); `exam-requests` ⇒ 404 (AC-EXM-04) | A |
| TC-EXM-07 | Completar exame com resultados e/ou PDF (atómico); sem nenhum ⇒ VALIDATION_ERROR; `issuedBy=CLINIC`; sem alertas por valor (AC-EXM-05) | A |
| TC-EXM-08 | PDF da clínica: quarentena + EICAR; só PDF; 6.º ficheiro; invisível ao paciente antes de COMPLETED, também depois de a conta da clínica ser removida; clínica nunca descarrega (AC-EXM-06) | I + A + S |
| TC-EXM-09 | **Concorrência:** `capacity+1` marcações simultâneas no mesmo horário ⇒ exatamente `capacity` sucessos (bloqueio do horário); marcação vs `PATCH capacity`/`DELETE` simultâneos sem overbooking nem marcações órfãs (AC-EXM-03); cancelar liberta vaga (AC-EXM-04) | I |
| TC-EXM-10 | Migração `0022`: linhas `REQUESTED`/`REJECTED` convertidas em CANCELLED; remover conta de clínica com exame/receita/PDF emitidos não viola CHECK; `uploaded_by_clinic` preenchido (AC-EXM-06/07) | I |
| TC-REC-01 | Criar recomendação só em origem própria SCHEDULED/COMPLETED; validação 1–2000; imutável (sem PUT/PATCH/DELETE); texto fora de logs/notificações (AC-REC-01) | A + S |
| TC-REC-02 | Leitura por categoria: titular/tutor, dependente (só consulta), OTHER com/sem partilha; retirada imediata (AC-REC-02) | A |
| TC-CLN-03 | Walk-in: lookup 200/404 indistinguível (inexistente/suspenso/sem SELF), sem ids na resposta, e-mail normalizado, sem pesquisa parcial; rate limits (conta, IP, falhas); marcação `SCHEDULED` no SELF, concorrência no mesmo horário (1 só vence), sobreposição, `kind` errado, outra clínica ⇒ NOT_FOUND, token de User/seguradora rejeitado; auditoria sem e-mail (canário em logs, AC-NFR-01); ambos os papéis (AC-CLN-05/06) | S |
| TC-CLN-02 | Isolamento entre clínicas em todas as rotas `/clinic-portal/exam-agenda*`, `slots` (incl. `PATCH`) e `recommendations` ⇒ NOT_FOUND; token de User/seguradora rejeitado (e vice-versa) (AC-EXM-04, AC-REC-01) | S |
| TC-CLN-04 | Catálogo (M14 a1): CRUD sem DELETE, desativar/reativar, nomes únicos entre ativos, limites, validações (duração, preço ≥ 0, `kind` imutável), `currency` AOA só leitura, ambos os papéis, listagem com `active`/`kind` (AC-CLN-07) | A + S |
| TC-CLN-05 | Regras e geração (M14 a2): geração esperada por dia/hora (incl. DST do `CLINIC_TIMEZONE`), janela de 8 semanas, idempotência (regenerar, job, repetir), `validFrom/validUntil`, ignorar passado, `capacity` só EXAM, regra sobreposta ⇒ `CONFLICT`, `EXCLUDE` na BD (sobreposição vs consecutivos vs outro profissional), concorrência (2 pedidos em paralelo), reconciliação ao editar/desativar com `keptBooked`, horário gerado não removível (AC-CLN-08/09/11); migração `0027` sobre dados existentes | U + I + A |
| TC-CLN-06 | Bloqueios (M14 a2): remove só livres, lista marcados sem PII, marcações intactas, `bookedSlotCount`, geração ignora intervalo, remover bloqueio regenera, publicação manual no intervalo ⇒ `CONFLICT`, validações de intervalo, concorrência com reserva (AC-CLN-10) | A + S |
| TC-CLN-07 | Duração e walk-in (M14 a2): sobreposição do paciente por duração, backfill (30 / do horário), defesa por profissional, `Appointment.durationMinutes` copiada do horário (AC-CLN-12) | U + A |
| TC-AZ-CLN-V2 | Isolamento entre clínicas em **todas** as rotas `/clinic-portal/professionals*`, `services*`, `schedule-rules*` (incl. `regenerate`) e `time-off*` ⇒ `NOT_FOUND` (inclusive `professionalId`/`serviceTypeId` de outra clínica em `POST /slots` e regras/bloqueios); token de User/seguradora rejeitado; Admin e Gestor com as mesmas permissões (matriz §6.2); auditoria sem nomes/`reason`/preços (canário em logs, AC-NFR-01) | S |
| TC-CLN-08 | Pacientes da clínica (M14 P): CRUD sem DELETE, validações (nome 1–120, telefone, e-mail, `birthDate` futura), pesquisa por nome sem acentos/maiúsculas, e-mail e dígitos de telefone, escape de `%`/`_` em `q`, paginação por cursor estável, rate limit 60/min, respostas sem ids Vita, auditoria sem PII (canário, AC-NFR-01) (AC-CLN-13) | A + S |
| TC-CLN-09 | Marcação presencial com paciente da clínica (M14 P): `clinicPatientId` manual ⇒ `ClinicVisit` e horário ocupado (concorrência Vita×visita no mesmo horário: 1 só vence), sobreposição do paciente e do profissional incl. visitas, cancelar/completar visita pelos endpoints da agenda (completar com receita ⇒ `VALIDATION_ERROR`), `patientEmail` cria/reutiliza `ClinicPatient` + `BOOKINGS`, exatamente um identificador, remover horário/bloqueio com visita ativa (AC-CLN-14) | U + A + S |
| TC-CLN-10 | Código de ligação (M14 P): formato/alfabeto, uso único, expiração 10 min (relógio injetável), invalidação do anterior, consumo concorrente (1 vence), 404 idêntico (inexistente/expirado/usado/paciente de outra clínica) com tempo de resposta comparável, rate limits (conta, falhas, IP, 5/h por membro), só o HMAC em BD, código ausente de logs/auditoria (canário), conflito de ligação, job de limpeza (AC-CLN-15) | S |
| TC-CLN-11 | Consentimento (M14 P): `PUT` `BOOKINGS`/`HISTORY` (validade +12 meses, renovar, rebaixar), expiração ⇒ nível efetivo `BOOKINGS` com `renewalNeeded` (relógio injetável), revogar apaga consentimento+ligação e a clínica perde a leitura no pedido seguinte, dependente via tutor, `DEPENDENT_SELF`/`OTHER` ⇒ `FORBIDDEN`, clínica privada/inexistente ⇒ `NOT_FOUND`, consentimento independente por clínica (AC-CLN-16) | A + S |
| TC-CLN-12 | Histórico partilhado, pesquisa e calendário (M14 P): `shared-history` só `HISTORY` válido (conteúdo exato: sem documentos/notas/tomas; janelas), `active=false` nos restantes casos, auditoria de leitura sem conteúdo; `search` (limites 10/10, só da clínica, futuras primeiro); `calendar` (estados incluídos, `freeSlots`, filtro por profissional, janela ≤31 dias, exames por exame, visitas), isolamento (AC-CLN-17/18); apagar membro/conta/família: cascata de ligações/consentimentos/códigos e registo da clínica intacto sem ids Vita (AC-CLN-19); migração `0028` | A + S |
| TC-AZ-CLN-V3 | Isolamento entre clínicas em **todas** as rotas `/clinic-portal/patients*` (incl. `link`, `record`, `shared-history`), `search` e `calendar` (incl. `professionalId`) ⇒ `NOT_FOUND`; `clinicPatientId` de outra clínica em `walk-in-appointments` e em `link`; token de User/seguradora rejeitado; Admin e Gestor iguais (§6.2); lado família (§6.4): matriz `SELF`/`TUTOR_OF`/`DEPENDENT_SELF`/`OTHER` × `clinic-consents`/`clinic-link-codes`, membro de outra família ⇒ `NOT_FOUND`; nenhuma resposta do portal contém `userId`/`familyId`/`memberId` (varrimento do JSON); auditoria sem nome/telefone/e-mail/notas/`q`/código | S |
| TC-CLN-13 | Confirmação (M14 Q): `GOING`/`CANNOT` (transições e idempotência, `GOING` após `CANNOT`, consulta passada/privada/não `SCHEDULED`), `CANNOT` cancela e liberta o horário (reserva concorrente de outro paciente depois), reativar repõe `PENDING`, `confirm` por telefone (consulta e visita), `confirmationStatus` em agenda/calendário/Hoje, `DECLINED` visível à clínica, matriz `SELF`/`TUTOR_OF`/`DEPENDENT_SELF`/`OTHER`, auditoria sem PII (AC-CLN-20/22) | U + A + S |
| TC-CLN-14 | Alertas de confirmação e retorno (M14 Q): scanner com relógio injetável (48 h, 24 h existente, <48 h, `CONFIRMED`/`CANCELLED`/privada), idempotência por `dedupeKey`, destinatários de dependente, texto genérico (canário: sem nome nem hora), preferência `appointmentReminder`, `FOLLOWUP_REMINDER` 7 dias antes e cancelado ao limpar o retorno, `alert_type` novos (AC-CLN-21, TC-ALR) | U + A |
| TC-CLN-15 | Fluxo do dia (M14 Q): `arrive`/`start`/`no-show`/`complete` em consulta e visita (estados, idempotência do primeiro `arrivedAt`, `NO_SHOW → SCHEDULED` na chegada tardia, janela do dia em `CLINIC_TIMEZONE` incl. DST/virada de dia, `waitingMinutes`, conclusão mantém resultado/receita), a app nunca vê `ARRIVED`/`IN_PROGRESS`, `NO_SHOW` não reabre horário (AC-CLN-22) | U + A |
| TC-CLN-16 | Indicadores e retorno (M14 Q): fixture com resultado conhecido para cada contagem/taxa (consultas, visitas, exames com vagas, `REJECTED`, sem desfecho, `slot_id` nulo, `byProfessional`, filtro, janela ≤ 366 dias, `null` sem divisão), rate limit 30/min, resposta sem PII (varrimento), isolamento; `follow-up` (cálculo semanas/meses no fim de mês, substituir, limpar, só `COMPLETED`, limpar ao sair de `COMPLETED`, lista ordenada/`until`), migração `0029` (AC-CLN-23/24) | U + A + S |
| TC-AZ-CLN-V4 | Isolamento entre clínicas em `PUT /agenda/{id}/confirm\|arrive\|start\|no-show\|follow-up`, `DELETE follow-up`, `GET /follow-ups` e `GET /reports/summary` (incl. `professionalId`) ⇒ `NOT_FOUND`; token de User/seguradora rejeitado; Admin e Gestor iguais (§6.2); lado família: `…/confirmation` × `SELF`/`TUTOR_OF`/`DEPENDENT_SELF`/`OTHER`, membro/consulta de outra família ⇒ `NOT_FOUND`; nenhuma resposta do portal contém `userId`/`familyId`/`memberId`; a clínica não consegue escrever `DECLINED` | S |
| TC-AZ-CLN-V5 | Isolamento entre clínicas em `/clinic-portal/receipts*` (lista, `GET`, `void`, `POST` com `bookingId`/`serviceTypeId` de outra clínica), `/profile`, `/audit` e `/staff` (incl. `professionalId` de outra clínica) ⇒ `NOT_FOUND`; **matriz por papel** (§6.2b) para Admin/Gestor/Médico em todas as rotas do portal (negação `FORBIDDEN` vs filtro `NOT_FOUND`); token de User/seguradora rejeitado; lado família (§6.5): `…/clinic-receipts*` × `SELF`/`TUTOR_OF`/`DEPENDENT_SELF`/`OTHER`, recibo/membro de outra família ⇒ `NOT_FOUND`; nenhuma resposta do portal ou da seguradora contém `userId`/`familyId`/`memberId`; o Médico nunca recebe `receiptId`/valores/lista de contas | S |
| TC-CLN-17 | Recibos (M14 R): emissão para consulta/exame/visita (linha do catálogo omitida, ajustada, livre; total; `notice`; retrato), validações (não `COMPLETED`, duplicado, outra clínica, sem preço, total 0), **numeração** sem buracos com 20 emissões concorrentes, rollback a meio e duas clínicas (BR-CLN-32), anulação e reemissão (número novo), imutabilidade (linhas/total/retrato; sem PUT/PATCH/DELETE), Financeiro por período (`summary` do período inteiro, anulados fora, DST/virada de dia, cursor), `receiptId` em `ClinicBooking`/`ClinicExamBooking`; migração `0030` (AC-CLN-25/26) | U + I + A |
| TC-CLN-18 | Recibo no lado do paciente e reembolso (M14 R): ligação só com consentimento e marcação Vita (nunca visita manual nem retroativa), sobrevive à revogação, apagar membro/família apaga a ligação e **mantém** o recibo sem ids Vita; matriz `SELF`/`TUTOR_OF`/`DEPENDENT_SELF`/`OTHER`; `receiptIds` em `createReimbursementClaim` (visibilidade, `VOIDED`, moeda, outro pedido ativo, reutilização após `REJECTED`, 1–10 no total, concorrência de dois pedidos sobre o mesmo recibo, BR-SEG-21 inalterado); `InsuranceClaimView.receipts` com o resumo mínimo (varrimento: sem PDF, ids, profissional) (AC-CLN-27) | U + I + A + S |
| TC-CLN-19 | Perfil e visibilidade na app (M14 R): `GET/PATCH /profile` (parcial, `null`, limites, e-mail, campos só leitura), papéis (Admin escreve, Gestor lê, Médico nada), `Clinic.displayName/description/openingHours` nas listas da família, clínica privada sem esses campos, retrato em recibos, auditoria só com nomes de campos (AC-CLN-28) | U + A |
| TC-CLN-20 | Papel Médico e auditoria da clínica (M14 R): criação/remoção de Médico (um por profissional, validações, token com `professionalId`, token Médico sem `professionalId` rejeitado), filtro por `slot.professional_id` em agenda, calendário, Hoje, exames, recomendações, retornos, pacientes (lista/`q`/ficha/histórico) com fixtures de dois profissionais, concluir/iniciar permitidos só nas suas, **matriz §6.2b completa** (teste gerado que percorre as rotas registadas × 3 papéis e compara com a matriz), `GET /audit` (isolamento por `actor_clinic_id`, só `CLINIC_ACCOUNT`, campos mínimos, varrimento sem PII, janela/retenção, cursor, rate limit) e backfill da migração (AC-CLN-29) | U + I + A + S |
| TC-CLN-21 | Relatório da consulta (M15 S): rascunho/atualização, validações (≥1 secção, limites, caracteres de controlo, `sharedWithPatient` em visita), `complete` com `report` atómico (falha da receita ⇒ nada muda), `finalize` idempotente, adendas (limite 20 concorrente), `INVALID_STATE_TRANSITION` em `FINAL`, janela `SCHEDULED`/`COMPLETED`, consulta Vita **e** visita manual | BR-CLN-41..44, AC-CLN-30 |
| TC-CLN-22 | **Imutabilidade na BD** (M15 S, I): `UPDATE` direto de qualquer coluna de um `FINAL` e de uma adenda falha (trigger); `ON DELETE SET NULL` da conta autora tem sucesso; CHECK de ≥1 secção, `FINAL ⇔ finalized_at`, 1:1 por marcação; apagar membro/consulta **não** apaga o relatório; apagar a clínica apaga relatório/adendas mas **não** rascunhos (sem `clinic_id`); apagar o exame/membro apaga o rascunho | BR-CLN-43/50, `schema.md` §3g |
| TC-CLN-23 | Relatório no lado do paciente e PDF (M15 S, A): matriz `SELF`/`TUTOR_OF`/`DEPENDENT_SELF`/`OTHER` (+ `SharingGrant`), sem `ClinicConsent`, `reportAvailable` por actor, `sharedWithPatient=false`/`DRAFT`/visita ⇒ `NOT_FOUND`; PDF (cabeçalho, secções vazias omitidas, adendas, assinatura textual, rodapé, marca de rascunho), nome de ficheiro sem PII, `no-store`, rate limit; auditoria sem texto; exportação do titular inclui o partilhado | BR-CLN-45/46, AC-CLN-31 |
| TC-CLN-24 | Rascunho de resultados e laudo (M15 T, I/A): rascunho invisível ao paciente, uso em `complete` (omitido vs. `[]`), limpeza ao concluir/cancelar; **função de realce** (testes de propriedade: `<min`, `>max`, igual ao limite, só texto, sem limites, `min>max` rejeitado); PDF sem `/JavaScript`/`/Launch`/`/URI`/`/EmbeddedFile`/`/AcroForm`; `Document` `generatedBySystem` (`CLEAN`, único por exame, fora do limite de 5 e da quota); objeto órfão em falha da transação ⇒ `file_deletions`; ausência de campos/alertas por valor; clínica descarrega só o laudo gerado | BR-CLN-47..49, AC-CLN-32/33 |
| TC-CLN-25 | Pedido de exame — clínica (M15 U, U + I): criação 1–5, validações (`name` xor `serviceTypeId`, limites, caracteres de controlo, serviço de exame), limite de 5 ativos com concorrência (advisory lock), imutabilidade (só estado/cancelamento), cancelar (idempotente, `FULFILLED` visível ⇒ `INVALID_STATE_TRANSITION`), `examOrders` em `complete` atómico, PDF (conteúdo, "URGENTE", rodapé, nome sem PII, sem `/JavaScript`/`/Launch`/`/URI`/`/EmbeddedFile`/`/AcroForm`), visita manual sem ponte; **BD:** CHECKs, apagar membro/consulta não apaga o pedido, apagar a clínica apaga pedidos e ligações, `examination_id → NULL` ao apagar o exame | BR-CLN-51/54/56, AC-CLN-34 |
| TC-CLN-26 | Pedido de exame — paciente e ligação (M15 U, I/A): alerta `EXAM_ORDER_ADDED` (um por pedido, destinatários `SELF`/`TUTOR_OF`, texto sem conteúdo), matriz `SELF`/`TUTOR_OF`/`DEPENDENT_SELF`/`OTHER` (+ `SharingGrant`), sem `ClinicConsent`, `examOrderCount` por actor, `examOrderId` (mesmo membro, `ORDERED`, `CONFLICT`/`NOT_FOUND`), transições `ExamOrderLinker` (marcar/concluir/cancelar/apagar/data passada), **máscara `booked_here`** (clínica de origem vs. destino vs. noutra clínica), cancelamento que não toca no exame, exportação do titular com `examOrders` | BR-CLN-52/53, AC-CLN-35 |
| TC-CLN-27 | Declaração de presença (M15 V, U + A): elegibilidade por estado (`COMPLETED`, `SCHEDULED` com chegada; `NO_SHOW`/`CANCELLED`/`REQUESTED`/sem chegada ⇒ `INVALID_STATE_TRANSITION`), consulta e visita, `includeProfessional`, ausência de especialidade/data de nascimento/diagnóstico no PDF, sem `/JavaScript`/`/Launch`/`/URI`, nada persistido, rate limit 30/min (bolsa partilhada com os outros PDF), auditoria `ATTENDANCE_STATEMENT_ISSUED` sem PII (canários), sem rota na família | BR-CLN-55, AC-CLN-36 |
| TC-AZ-CLN-V6 | Matriz de papéis e isolamento do M15 (§6.2b): só o Médico escreve relatórios (Admin/Gestor ⇒ `FORBIDDEN` sem efeito parcial, incl. `complete` com `report`); Médico só as suas marcações; outra clínica ⇒ `NOT_FOUND` em `report*`, `results-draft`, `exam-agenda/*/report/pdf`; rotas da família `report*` só `SELF`/`TUTOR_OF`; texto/valores/diagnóstico ausentes de logs e de `audit_logs` (canários) | BR-CLN-44/45/50, `authorization.md` §6.2b/§6.6 |
| TC-AZ-CLN-V7 | Matriz de papéis, isolamento e família de M15 U/V (§6.2b, §6.7): só o Médico cria/cancela pedidos (Admin/Gestor ⇒ `FORBIDDEN` sem efeito parcial, incl. `complete` com `examOrders`); Admin/Gestor/Médico(suas) leem/imprimem pedido e emitem declaração; outra clínica ⇒ `NOT_FOUND` em `exam-orders*` e `attendance-statement`; rotas da família `exam-orders` só `SELF`/`TUTOR_OF`; a matriz em código coincide com as rotas do `openapi.yaml` (TC-AZ-CLN-V5); canários: nome do exame, nota e nome do paciente ausentes de logs, `audit_logs` e alertas | BR-CLN-51..56, `authorization.md` §6.2b/§6.7; `GET /clinic-portal/exam-service-types` (Admin/Gestor/Médico: só serviços `EXAM` ativos da própria clínica, campos `id`/`name`/`durationMinutes`, sem preços; outra clínica nunca aparece; `GET /clinic-portal/services` continua `FORBIDDEN` para o Médico) |

> **Nota M7 (change control, mesmo padrão da nota M6 em TC-AUTH-12):** TC-APT-01 (metade "lembretes 24h/2h recalculados") e TC-APT-02 (metade "pedido de desfecho 24h depois") descrevem o scanner de `alerts`, que só existia em M8 (`modules.md` §2: `alerts` depende de `appointments`, nunca o inverso — `plan.md` §4 confirma `FR-ALR` em M8). Implementado em M7: os dados de que `alerts` vai precisar (`scheduledAt`, `status`, `outcomeRequestedAt`) ficam corretos, e nenhum processo deste módulo muda o estado por si só — caso coberto em `appointments/application/appointments.test.ts` ("AC-APT-02: nunca muda de estado por si só"). TC-APT-03 (ST4), TC-CLN-01 e TC-EXM-01/02/03 estão cobertos nos testes de `appointments`/`clinics`/`examinations` (`application/*.test.ts`).
>
> **Nota M8 (concluído):** as metades pendentes de TC-APT-01/02 (geração de lembretes 24h/2h e pedido de desfecho) e TC-ALR-01..08 (abaixo) estão cobertas em `alerts/application/scan-job.test.ts`, `alerts/application/alerts.test.ts`, `alerts/domain/*.test.ts`, `notifications/application/*.test.ts` e `notifications/domain/*.test.ts`.

## 5. Documentos (TC-DOC)
| ID | Caso | Nível |
|---|---|---|
| TC-DOC-01 | Upload válido ⇒ PENDING ⇒ CLEAN ⇒ download | I + A |
| TC-DOC-02 | EICAR ⇒ eliminado, recusado, auditado | I |
| TC-DOC-03 | Extensão falsa/magic bytes, >10 MB, 6.º ficheiro, quota 100 MB | A |
| TC-DOC-04 | Download exige permissão da categoria; auditado; cabeçalhos de cache | A + S |
| TC-DOC-05 | Download de documento PENDING ⇒ `DOCUMENT_NOT_AVAILABLE` | A |
| TC-DOC-06 | Outbox: apagar recurso enfileira e apaga objeto; retry se storage falha | I |
| TC-DOC-07 | Checksum guardado e verificado | I |

## 6. Alertas e notificações (TC-ALR)
| ID | Caso | Nível |
|---|---|---|
| TC-ALR-01 | Scanner gera alerta de toma no horário; repetição única aos 15 min; sem repetição se confirmada | I (relógio) |
| TC-ALR-02 | Idempotência: scanner N vezes ⇒ sem duplicados (`dedupeKey`) | I |
| TC-ALR-03 | Destinatários: titular; D sem conta ⇒ tutores; D com conta ⇒ D e tutores | I |
| TC-ALR-04 | Texto genérico (sem nomes, medicamentos, horas) em push e e-mail | A + S |
| TC-ALR-05 | Preferências: canais e tipos; falha de um canal não impede o outro | I |
| TC-ALR-06 | Retry com backoff (5 tentativas); SKIPPED para conta suspensa/sem canal | I |
| TC-ALR-07 | Lembretes de consulta 24 h/2 h e exame 24 h; recálculo ao editar/cancelar | I |
| TC-ALR-08 | Subscrições push inválidas removidas | I |

## 7. Relatórios e exportação (TC-RPT)
| ID | Caso | Nível |
|---|---|---|
| TC-RPT-01 | Relatório individual respeita partilha por secção (omite sem permissão) | A |
| TC-RPT-02 | Visão familiar respeita D13; Admin sem privilégio | A |
| TC-RPT-03 | Período por defeito 12 meses; >5 anos recusado; paginação | A |
| TC-RPT-04 | Exportação (titular, tutor pelo dependente, menor recusado) com JSON + documentos | I + A |

## 8. Auditoria, RGPD, operação (TC-AUD/OPS)
| ID | Caso | Nível |
|---|---|---|
| TC-AUD-01 | Ações sensíveis produzem registo completo (sem dados de saúde no metadata) | I |
| TC-AUD-02 | Anonimização ao eliminar User; purga a 24 meses | I (relógio) |
| TC-AUD-03 | Papel de BD da aplicação não consegue UPDATE/DELETE em `audit_logs` | I |
| TC-LOG-01 | Dados canário não aparecem em logs, erros nem notificações | S |
| TC-DEL-01 | Hard delete (User/família/membro): BD + storage + auditoria anonimizada | I |
| TC-ARCH-01 | Regras de dependência de módulos (`admin` sem imports de saúde, sem ciclos) | U (arquitetura) |
| TC-CON-01 | OpenAPI do código = repositório; respostas validam o schema | A |
| TC-MIG-01 | Sem *drift* entre migrações e esquema; constraints críticas violáveis só com erro | I |
| TC-OPS-01 | Health e readiness; degradação com Redis/BD em baixo | A |

## 8b. Administração e seguradoras (TC-ADM / TC-INS, ADR-023)
| ID | Caso | Nível | Liga a |
|---|---|---|---|
| TC-ADM-01 | `GET /admin/users?q=` e detalhe: sem dados de saúde; não-admin ⇒ 403; imports de `admin` verificados | A + arquitetura | AC-ADM-01 |
| TC-ADM-02 | `reset-access`: sessões revogadas, e-mail enviado, sem token na resposta, auditado, não a si próprio | A + S | AC-ADM-02 |
| TC-ADM-03 | Contas de clínica: listar, suspender (revoga `clinic_sessions`, ≤60 s), reativar; CONFLICT em `CLINIC_ADMIN` duplicado; `TC-AZ-ADM-*` (token de clínica/seguradora nunca autoriza `/admin/*`) | A + S | AC-ADM-03 |
| TC-ADM-04 | Seguradoras: criar, editar, suspender/reativar, NIF único, sem DELETE | A | AC-ADM-04 |
| TC-INS-01 | Apólice com/sem seguradora parceira; reembolso: SUBMITTED/VALIDATION_ERROR/CONFLICT (suspensa); CHECK de `reimbursement_claims` aceita SUBMITTED | A + I | AC-INS-01 |
| TC-INS-02 | Portal da seguradora: decidir com/sem motivo; isolamento entre seguradoras; só documentos listados; `TC-AZ-INS-*` | A + S | AC-INS-02 |

### 8b. Seguradoras — módulo operacional, Fase A (TC-SEG / TC-AZ-SEG; ADR-025, contrato 2026-11-11; `vita-qa-security`)
> Gerados da matriz `authorization.md` §8.2b/§8.4/§8.5 (restrita à Fase A). Ligam-se a BR-SEG-* (ainda sem AC-SEG; criar antes do marco).
| ID | Caso | Nível | Liga a |
|---|---|---|---|
| TC-AZ-SEG-01 | Matriz de papéis da Fase A em **todas** as rotas `/insurance-portal/{companies,beneficiaries,imports,link-requests,policies,plans,services,partner-clinics,providers}*`: `INSURANCE_ADMIN` e `BENEFICIARY_MANAGER` conforme §8.2b (escrita/leitura); `INSURANCE_AGENT` ⇒ `FORBIDDEN`; escrita de planos/serviços/providers e `GET partner-clinics` por `BENEFICIARY_MANAGER` ⇒ `FORBIDDEN` sem efeito parcial | A + S | BR-SEG-14, §8.2b |
| TC-AZ-SEG-02 | **Isolamento entre seguradoras:** com dois tenants, todo o `GET/PATCH/POST` por id (empresa, beneficiário, importação, pedido de ligação, apólice, plano, serviço, provider) com id da outra seguradora ⇒ `NOT_FOUND`; listas só com linhas próprias; `companyId`/`holderId`/`planId`/`serviceId` de outra seguradora em corpo ou filtro ⇒ `VALIDATION_ERROR`/vazio, nunca cruzamento; teste direto à BD: FK composta `(insurer_id, id)` rejeita a referência cruzada | A + I | BR-SEG-14 |
| TC-AZ-SEG-03 | Tokens distintos: `insuranceAccessToken` nunca em `/clinic-portal/*` nem `/families/*`; token de clínica/User nunca em `/insurance-portal/*`; seguradora sem `operationalModuleEnabled` ⇒ `NOT_FOUND` nas rotas novas (mas reembolsos intactos) | A + S | ADR-021/025 |
| TC-AZ-SEG-04 | Clínica sobre seguradora (§8.4): sem `insurer_providers` ativo (ou provider `SUSPENDED`, ou módulo desligado) ⇒ `NOT_FOUND` em `eligibility` e `services`, e a seguradora não aparece em `GET /clinic-portal/insurers`; `CLINIC_ADMIN`/`CLINIC_MANAGER` ✓, `CLINIC_DOCTOR` ⇒ `FORBIDDEN`; clínica A não vê a ligação da clínica B | A + S | BR-SEG-18/23 |
| TC-AZ-SEG-05 | App do paciente (§8.5): `SELF`/`TUTOR_OF` ✓; `OTHER`, Family Admin sem tutela e outro membro ⇒ `NOT_FOUND`; `cardId`/`beneficiaryId`/`claimId` de outro membro, família ou seguradora ⇒ `NOT_FOUND` (IDOR); cartão/QR/cobertura sem ligação `CONFIRMED` ⇒ `NOT_FOUND` | A + S | BR-SEG-20 |
| TC-SEG-01 | Importação CSV e XLSX: 5.000 linhas OK, 5.001 ⇒ `VALIDATION_ERROR`; ficheiro vazio/tipo errado ⇒ `FILE_TYPE_NOT_ALLOWED`; pré-visualização com erros por linha (`REQUIRED`, `INVALID_FORMAT`, `DUPLICATE_IN_FILE`, `DUPLICATE_EXISTING`, `HOLDER_NOT_FOUND`); pré-visualização **não grava**; `commit` numa só transação (falha a meio ⇒ nada gravado), linhas inválidas/duplicadas ignoradas e contadas, beneficiários nascem `PENDING`, nunca `ACTIVE`; `commit`/`DELETE` fora de `PREVIEW` ⇒ `CONFLICT` | A + I | BR-SEG-17 |
| TC-SEG-02 | Estados: Beneficiário (`PENDING→ACTIVE⇄SUSPENDED→CANCELLED`, final), Apólice (`DRAFT→ACTIVE` exige plano `ACTIVE`; `EXPIRED` só pelo job `insurer.expire-policies`, idempotente), Plano (`DRAFT→ACTIVE` exige ≥1 cobertura; `new-version` copia coberturas; plano com apólices ativas imutável ⇒ `CONFLICT`); notas obrigatórias; transições inválidas ⇒ `INVALID_STATE_TRANSITION` | U + A | state-machines, BR-SEG-01 |
| TC-SEG-03 | Cobertura: `PUT coverages` só em `DRAFT`; `serviceId` de outra seguradora ⇒ `VALIDATION_ERROR`; mapeamento `covered`/`limitPerYear` → `coverage_type`; `copayPct` 0..100; serviço ausente = não coberto | A + U | BR-SEG-02/09/22 |
| TC-SEG-04 | Reclamar cartão: código correto ⇒ `PENDING`; código errado/expirado/de outra seguradora/apólice inexistente ⇒ **mesmo** `NOT_FOUND` (anti-enumeração, indistinguível em corpo e tempo); rate limit ⇒ `RATE_LIMITED`; código em claro só na emissão (hash na BD); emitir novo invalida o anterior; seguradora confirma/rejeita (motivo); desligar ⇒ `REVOKED` e cartão/cobertura passam a `NOT_FOUND`; o beneficiário mantém-se; eliminar membro/família só quebra a ligação | A + I + S | BR-SEG-20 |
| TC-SEG-05 | Elegibilidade (`POST …/eligibility`): `ACTIVE`+apólice `ACTIVE`+datas ⇒ `eligible:true`; beneficiário/apólice não elegível, documento/cartão inexistente, QR expirado/revogado (`cardVersion`)/de outra seguradora ⇒ **resposta idêntica** `{eligible:false, notice}`; resposta mínima: sem ids de família, sem dados de saúde, sem outra seguradora, **sem `used`/`reserved`**; carência ⇒ `coveredNow:false`; exatamente um identificador (senão `VALIDATION_ERROR`); `EXCLUDED` não listado; `serviceCode` filtra | A + S | BR-SEG-01/04/18 |
| TC-SEG-06 | Rate limit de elegibilidade por conta de clínica e por IP ⇒ `429` + `Retry-After`; cada validação (incl. `eligible:false` e 429) gera `ELIGIBILITY_CHECK` **sem** cartão/QR/documento/nome em `metadata` nem em logs (dados canário) | A + S | BR-SEG-15/18 |
| TC-SEG-07 | Cartão e cobertura no app: um cartão por seguradora; QR de validade curta e revogável, sem dados clínicos; `…/coverage` devolve cobertura e limites **sem** `used`/`reserved`/saldo (D-A2); beneficiário não `ACTIVE` mostra o estado; várias seguradoras ⇒ cartões independentes, sem somas | A | BR-SEG-19/20/23, UC-SEG-14/15 |
| TC-SEG-08 | Privacidade: nenhuma resposta das rotas da seguradora contém ids/nomes de utilizador, família ou membro do paciente nem dados de saúde (`linked: bool` apenas); nenhum dado do app é lido pelos casos de uso de `insurer-ops` para subscrição, prémio ou cobertura (`privacy.md` §3); teste de arquitetura: `insurer-ops` não importa módulos de saúde | A + arquitetura | `privacy.md`, ADR-025/C2 |
| TC-SEG-09 | Moeda: `currency` ISO 4217 (`AOA` por omissão), só `PLATFORM_ADMIN` altera, `CONFLICT` com dados criados; `operationalModuleEnabled` só `PLATFORM_ADMIN`; auditoria `ADMIN_INSURER_*` | A | BR-SEG-19 |
| TC-SEG-10 | Conformidade OpenAPI das 44 operações da Fase A (respostas e erros validados contra `openapi.yaml`); `Insurer` devolve `currency`/`operationalModuleEnabled` | A | contrato |
| TC-SEG-11 | Clínicas parceiras (`GET /insurance-portal/partner-clinics`): só `INSURANCE_ADMIN`; só clínicas `PARTNER`+`ACTIVE` (nunca `FAMILY`/inativas); **minimização**: cada item contém exatamente `id` e `name` (teste com chaves canário: sem morada, telefone, e-mail, contas, `family_id`, horários, `display_name`/descrição); `q` filtra por nome, paginação estável; seguradora sem `operationalModuleEnabled` ⇒ `NOT_FOUND`; `POST providers` com `clinicId` de clínica não parceira/inativa/inexistente ⇒ `NOT_FOUND` idêntico, já ligada ⇒ `CONFLICT`; ligação de A invisível a B (isolamento); `q` ausente de logs/auditoria | A + S | BR-SEG-14/18, ADR-005 |

## 9. Segurança adicional (TC-SEC)
Cabeçalhos de segurança · CORS restrito · rejeição de campos desconhecidos (whitelist) · limites de corpo · injeção em texto livre · enumeração (registo/recuperação/convites) · SSRF em endpoints push · refresh sem cabeçalho CSRF recusado · cookie com flags corretas.

## 10. Carga e resiliência (TC-PERF / TC-RES)
| ID | Caso | Alvo |
|---|---|---|
| TC-PERF-01 | 1 000 famílias / 5 000 users: leituras p95 ≤ 500 ms; escritas p95 ≤ 1 s | NFR-PERF-01/02 |
| TC-PERF-02 | Pico de lembretes às horas redondas: atraso ≤ 1 min | NFR-PERF-03 |
| TC-PERF-03 | Scanner com 100 000 ocorrências futuras: tempo por execução ≪ 1 min | ADR-009 |
| TC-RES-01 | Perda do Redis: filas reconstruídas a partir da BD sem perder nem duplicar lembretes | ADR-004 |
| TC-RES-02 | Falha do SMTP/Push: retry e entrega posterior | ST6 |
| TC-RES-03 | Restauro de backup (RPO ≤ 24 h, RTO ≤ 8 h) | N10 |
