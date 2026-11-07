# Portal da clínica v2 ("Clínica v2", M14) — roadmap e frontend

> Estado: **ACEITE** (2026-11-07), decorrente de **ADR-026 / D22** (decisão do proprietário; critério "máximo valor para a clínica, mínima complexidade para o utilizador"). Este documento fixa **direção, fases e arquitetura de informação**; **não é contrato**. Cada fase só arranca depois de ter BR/UC, `schema.md`, `openapi.yaml` e `endpoints.md` validados (como em ADR-023). Ver também `plan.md` (M14); OP-24..30 resolvidos em `open-points.md`.

## 0. Princípios (herdados de ADR-026)
1. A clínica tem registo próprio (`ClinicPatient`) e é responsável por ele; o Vita é canal/subcontratante.
2. Dados Vita só chegam à clínica por **consentimento** por clínica/categoria/prazo, revogável; sem consentimento vale BR-CLN-03 original.
3. Sem chat livre, sem teleconsulta, sem faturação fiscal certificada, sem prontuário completo (fase 2).
4. Isolamento por `clinic_id` (404 sem enumeração), auditoria sem PII, rate limits nas pesquisas (BR-CLN-10).
5. Reutilizar o que existe: `ClinicSlot` continua a ser a unidade reservável; a nova agenda **gera** slots (não os substitui). Walk-in, exames, receitas, recomendações (BR-CLN-04..10) mantêm-se.

## 1. Fases

### Fase (a) — Modelo de agenda
- **Âmbito:** profissionais; tipos de consulta com duração e preço; regras de horários semanais; bloqueios/férias; lista de espera; deteção de sobreposição por duração; registo básico `ClinicPatient` (nome, telefone/e-mail opcionais, sem ligação Vita) usado por lista de espera e marcações presenciais.
- **BR a criar:** profissional não pode ter dois slots sobrepostos (intervalo `[início, início+duração)`); regras geram slots numa janela rolante (proposta 60 dias) sem apagar slots com marcações ativas (alinha com BR-CLN-04); bloqueio/férias cancela só slots **livres** e **obriga** a tratar os marcados (lista a reagendar); lista de espera: ordem FIFO por tipo/profissional, oferta automática de vaga libertada com prazo de aceitação (proposto 2 h), expira; preço opcional, valor ≥ 0, moeda da clínica (omissão AOA).
- **FR/UC a criar:** FR-CLN-04..07; UC-CLN-09 (gerir profissionais), 10 (tipos de consulta), 11 (regras/bloqueios), 12 (lista de espera), 13 (registo de paciente da clínica).
- **Entidades novas:** `Professional`, `ConsultationType` (`durationMin`, `priceMinor`, `currency`), `AvailabilityRule`, `TimeBlock`, `WaitlistEntry`, `ClinicPatient`; `clinic_slots.professional_id`/`consultation_type_id`/`duration_min` (o campo de duração já existe — confirmar em `schema.md`).
- **Endpoints (esboço):** `/clinic-portal/professionals`, `/consultation-types`, `/availability-rules`, `/time-blocks`, `/waitlist`, `/patients` (CRUD próprio), `/calendar?professionalId&from&to`.
- **Critérios de aceitação (alto nível):** dois slots do mesmo profissional sobrepostos ⇒ `CONFLICT`; regra semanal gera os slots esperados e é idempotente; férias sobre dia com marcações lista-as e não as cancela sozinha; vaga libertada oferece ao 1.º da lista; outra clínica nunca vê/usa profissionais, tipos, pacientes (404).

### Fase (b) — Confirmação ativa, indicadores e retorno
- **Âmbito:** pedido de confirmação ao paciente a **48 h e 24 h** (alerta Vita, só texto genérico, BR-ALR-07; depende de OP-07/OP-22); resposta do paciente (confirmar/cancelar) na app; indicadores de faltas (no-show) e ocupação; marcação de retorno.
- **BR a criar:** `confirmationStatus` (`PENDING|CONFIRMED|DECLINED|NO_REPLY`) separado do estado da consulta (ST); cancelar pelo paciente liberta slot e dispara lista de espera; no-show marcado manualmente pela clínica após a hora (transição nova em `state-machines.md`, a decidir: estado `NO_SHOW` vs. marca); indicador sem PII (agregados); retorno = nova consulta `SCHEDULED` no mesmo paciente/profissional por regra (sugestão de data, confirmação do paciente se ligado).
- **FR/UC:** FR-CLN-08..10; UC-CLN-14 (confirmações), 15 (indicadores), 16 (retorno).
- **Entidades:** `appointments.confirmation_status`, `AppointmentReminder` (ou reutilizar `alerts`), `appointments.no_show_at`, `appointments.followup_of_id`.
- **Endpoints:** `POST /families/{f}/members/{m}/appointments/{id}/confirm|decline` (app); `GET /clinic-portal/reports/occupancy|no-shows`; `POST /clinic-portal/appointments/{id}/no-show|follow-up`.
- **Aceitação:** lembretes enviados uma vez por janela (idempotente); declínio liberta o slot; taxa de faltas = faltas/(marcações passadas SCHEDULED); relatórios só da própria clínica e sem dados pessoais.

### Fase (c) — Check-in, fila do dia, pesquisa por QR/código, pré-consulta
- **Âmbito:** receção faz check-in; fila do dia por profissional (`WAITING → IN_CONSULTATION → DONE`); pesquisa de paciente por **código/QR** gerado na app; formulário de pré-consulta (campos estruturados, definidos pela clínica, preenchidos pelo paciente na app).
- **BR a criar:** código de paciente de uso único e curta validade (10 min; resposta idêntica 404; rate limit e auditoria como BR-CLN-10); QR codifica só o código; check-in só no dia da marcação; pré-consulta = respostas **do paciente**, nível "Marcações" do consentimento; sem texto livre clínico interpretado, sem alertas por conteúdo (D11).
- **FR/UC:** FR-CLN-11..13; UC-CLN-17 (check-in/fila), 18 (pesquisa por código), 19 (pré-consulta).
- **Entidades:** `appointments.checked_in_at`, `QueueEntry` (ou estado derivado), `PatientLookupCode` (app-side, hash, expiração), `IntakeForm`, `IntakeResponse`.
- **Endpoints:** `POST /clinic-portal/appointments/{id}/check-in`, `GET /clinic-portal/queue`, `POST /clinic-portal/patient-lookup/code`, `POST /families/{f}/members/{m}/lookup-code`, `GET/PUT intake-forms`, `POST .../intake-responses`.
- **Aceitação:** código expira e não se reutiliza; 404 idêntico para inválido/expirado/consumido; fila ordenada por hora de check-in; pré-consulta só visível à clínica com consentimento ativo.

### Fase (d) — Partilha por consentimento e mensagens estruturadas
- **Âmbito:** `ClinicConsent` (clínica × membro; **12 meses renovável**; revogação; **2 níveis visíveis**: "Marcações" por omissão e "Partilhar histórico" = medicação e exames; um interruptor por clínica); ligação `ClinicPatient` ↔ membro Vita; ficha do paciente com consultas, exames, recomendações e consentimentos; mensagens estruturadas clínica↔paciente por catálogo (confirmação, lembrete de jejum, resultados disponíveis, pedido de documento, reagendamento) com **parâmetros tipados** (data, hora, local), **sem texto livre**.
- **BR a criar:** ver ADR-026 (consentimento por categoria, prazo, revogação imediata; clínica conserva o seu); a app mostra ao paciente "quem vê o quê" e permite revogar; cada mensagem usa um template aprovado (`MessageTemplate`) e gera alerta genérico; limites de volume por paciente/dia (anti-spam); mensagens expiram/arquivam; paciente pode bloquear a clínica (= revogar e silenciar).
- **FR/UC:** FR-CLN-14..17; UC-CLN-20 (convidar/ligar paciente), 21 (consentir/revogar na app), 22 (ficha com dados consentidos), 23 (mensagem estruturada).
- **Entidades:** `ClinicConsent`, `ClinicConsentCategory` (ou array), `ClinicPatientLink`, `MessageTemplate`, `ClinicMessage`; auditoria `CLINIC_CONSENT_*`, `CLINIC_MESSAGE_SEND` (sem PII).
- **Endpoints:** `POST /clinic-portal/patients/{id}/invite`; app: `GET/POST/DELETE /families/{f}/members/{m}/clinic-consents`; `GET /clinic-portal/patients/{id}/record?category=`; `POST /clinic-portal/messages`, `GET /families/{f}/members/{m}/clinic-messages`.
- **Aceitação:** sem consentimento a ficha só tem dados da clínica; revogar remove de imediato a visão Vita e bloqueia novas mensagens; consentimento expirado = revogado; dependente exige tutor; isolamento entre clínicas testado; exportação/apagamento (`lifecycle`) cobre consentimentos e ligações (OP-27).

### Fase (e) — Preços, recibos e comprovativo para reembolso
- **Âmbito:** preço aplicado à consulta/exame (a partir do catálogo, editável com motivo); **recibo interno não fiscal**; **comprovativo para reembolso** (PDF) que o paciente anexa a um pedido (M11, `ReimbursementClaim`); integra com `Encounter` do módulo de seguradoras (S3) quando houver validação de seguro.
- **BR a criar:** recibo numerado **sequencialmente por clínica**, imutável (anulação = novo documento); texto "documento não fiscal" obrigatório; serve de comprovativo de reembolso; valores em **cêntimos (inteiros)**, moeda configurável por clínica (omissão **AOA**), preço final sem desdobrar impostos; comprovativo só liberta dados mínimos (clínica, data, serviço, valor, paciente); entrega ao paciente por consentimento (nível "Marcações"; sem categoria própria), senão impresso/entregue em mãos.
- **FR/UC:** FR-CLN-18..20; UC-CLN-24 (registar pagamento/recibo), 25 (comprovativo), 26 (relatório financeiro).
- **Entidades:** `Receipt`, `ReceiptLine`, `Payment` (método, valor), `ReimbursementProof`; `appointments.price_minor` / `examinations.price_minor`.
- **Endpoints:** `/clinic-portal/receipts`, `/payments`, `/receipts/{id}/proof` (PDF via `documents`), app: `GET .../clinic-receipts`.
- **Aceitação:** numeração sem falhas nem duplicados por clínica; recibo não editável; comprovativo contém só o mínimo; papel Médico não vê financeiro; coordenar com S3/S5 para não duplicar despesas.

### Fase (f) — Perfil público e papel `CLINIC_DOCTOR`
- **Âmbito:** perfil público (descrição, morada, contactos, horário, serviços/profissionais visíveis, logótipo) apresentado na app (BR-CLN-01: já visíveis); mantêm-se **`CLINIC_ADMIN`** e **`CLINIC_MANAGER`** (o Gestor faz de receção) e acrescenta-se **só `CLINIC_DOCTOR`**.
- **BR a criar:** BR-CLN-05 estendida (uma `CLINIC_ADMIN` raiz; o admin cria Gestores e Médicos); matriz em `authorization.md` §6.2 (Médico: os seus pacientes/consultas, resultados, receitas, recomendações; sem financeiro nem equipa; Gestor: tudo menos equipa; Admin: tudo + equipa, definições e **auditoria, visível só ao Admin**); perfil público só texto/imagem, sem dados de pacientes; Médico associado a `Professional`.
- **FR/UC:** FR-CLN-21..22; UC-CLN-27 (perfil público), 28 (equipa e papéis).
- **Entidades:** `ClinicProfile` (ou campos em `clinics`), `clinic_account_role` + `CLINIC_DOCTOR`, `ClinicAccount.professional_id`.
- **Endpoints:** `GET/PATCH /clinic-portal/profile`, `GET /clinics/{id}/profile` (app), extensão de `/clinic-portal/staff`.
- **Aceitação:** cada papel só chega às rotas da matriz (`TC-AZ-CLN-*`), item escondido no UI **e** negado no servidor; perfil público sem PII; contas existentes não perdem acesso.

## 2. O que falta documentar (por fase, antes de implementar)
- `business-rules.md`: BR-CLN-11.. (a–f); `functional-requirements.md`: FR-CLN-04..22; `03-use-cases/clinic.md`: UC-CLN-09..28.
- `schema.md` e `indexes.md` (entidades acima; `ON DELETE`; exclusão de sobreposição por `tstzrange` + `EXCLUDE`); `migrations.md`.
- `openapi.yaml` + `endpoints.md` + `errors.md`; `authorization.md` §6.2 (`CLINIC_DOCTOR`), `audit.md` §3 (ações `CLINIC_*`), `modules.md` §3 (módulo `clinic-ops` e portas para `family`/`identity`/`alerts`/`documents`), `state-machines.md` (no-show, check-in, fila), `privacy.md` (papéis RGPD, DPA, retenção), `test-cases.md`/`acceptance-criteria.md`.
- Emendas a BR-CLN-09/D15 (apagamento: dados Vita apagam-se, registo da clínica fica desligado; retenção configurável, omissão = mínimo legal) e BR-CLN-05 (`CLINIC_DOCTOR`, fase f).

## 3. Frontend do portal da clínica

### 3.1 Shell (desktop-first, simplicidade primeiro)
- **Sidebar com 6 itens**: **Hoje**, **Agenda**, **Pacientes**, **Serviços**, **Exames**, **Mais** (Financeiro, Relatórios, Definições). **Progressive disclosure:** itens e sub-itens de fases futuras ficam **ocultos** até existirem (sem estados "em breve").
- **Topo:** **pesquisa global única** (pacientes da clínica por nome/telefone/código; consultas; exames; e, com e-mail exato, o utilizador Vita para marcar presencial) e menu da conta (utilizador/clínica; a conta pertence a **uma** clínica, ADR-020, logo sem seletor de clínica; terminar sessão).
- **Hoje** é a **página inicial** (agenda do dia, pedidos por tratar) com **3 ações rápidas**: **Consulta presencial**, **Novo horário**, **Pesquisar paciente**. ("Novo paciente" faz-se a partir de Pacientes/pesquisa quando existir o registo, fase (a).)
- **Pesquisa — coerência com BR-CLN-10/ADR-026:** a pesquisa no Vita continua exata e com resposta mínima (404 idêntico); a do registo da clínica nunca revela contas Vita; resultados por secção.

### 3.2 Navegação (itens aparecem quando a fase os entrega)
| Item | Conteúdo (sub-separadores) | Disponível | Papéis |
|---|---|---|---|
| **Hoje** | Dia (agenda do dia, pedidos pendentes); Fila/check-in | agora; fila na fase (c) | Admin, Gestor, Médico (os seus) |
| **Agenda** | Calendário (por profissional a partir de (a)); Pedidos; Horários e disponibilidade; Lista de espera | agora; calendário/regras/espera em (a) | Admin, Gestor; Médico só o seu calendário |
| **Pacientes** | Pesquisa/lista; Ficha (consultas, exames, recomendações; "Partilha" a partir de (d)) | (a)/(d) | Admin, Gestor; Médico os seus |
| **Serviços** | Tipos de consulta e exames (duração/preço); Profissionais | (a) | Admin, Gestor |
| **Exames** | Marcações; Agenda e ocupação; Resultados (vista, BR-CLN-08) | agora | Admin, Gestor, Médico |
| **Mais** | Financeiro (Recibos), Relatórios (Ocupação, Faltas, Novos pacientes), Definições (Perfil, Equipa e papéis, Notificações, Auditoria) | Equipa agora; Relatórios (b); Financeiro (e); Perfil/Médico (f) | Definições: Admin; Financeiro e Relatórios: Admin e Gestor; **Auditoria só Admin** |

Incoerências resolvidas: (1) em Exames não há "pedidos" (ADR-023 revisto): chama-se "Marcações". (2) "Resultados" é vista sobre marcações. (3) Auditoria da clínica não existe hoje: só entra com contrato novo, sem PII, e só o Admin a vê (P7 de `audit.md` §2 a ratificar). (4) Comunicação (lembretes/mensagens) deixa de ser grupo próprio: lembretes/confirmações vivem em Hoje/Agenda e as mensagens estruturadas na Ficha do paciente, para reduzir navegação.

### 3.3 Padrões de UI
- **Ficha do paciente como centro:** tabs Resumo | Consultas | Exames | Recomendações | Consentimentos | Financeiro; as tabs dependentes de consentimento mostram "Sem partilha ativa" com o que pedir ao paciente (convite). Nunca mostra ids Vita.
- **Pesquisa global** com atalho `/` ou `Ctrl+K`; **tabelas** com filtros guardados (por utilizador, em `localStorage`; sem PII nos nomes dos filtros), paginação e ordenação servidor; **drawer** lateral para detalhes (consulta, exame, mensagem) sem perder o contexto da lista; **estados vazios com ação** ("Sem horários — Novo horário"); **atalhos** (`G H` hoje, `G A` agenda, `G P` pacientes, `N` novo, `?` ajuda); **permissões por papel** escondem itens **e** o servidor continua a negar (UI não é segurança); **responsivo**: abaixo de 768 px só **Hoje** (com Pedidos) e **pesquisa** (resto "disponível no computador"); acessibilidade e i18n como no resto da PWA.

### 3.4 Estrutura de código (`apps/web/src`)
```
pages/clinic/<area>/...        today/ agenda/ patients/ services/ exams/ more/ (finance/ reports/ settings/)
components/clinic/<área>/...   shell/ (Sidebar, Topbar, GlobalSearch, QuickActions, Drawer), agenda/, pacientes/ ...
services/clinic/*              um serviço por recurso (agenda.service.ts, patients.service.ts, ...); hoje `services/clinicPortal.service.ts`
mocks/handlers/clinic/*        um handler por recurso; dados em mocks/data/clinic*
rotas (em inglês)              /clinic (Hoje) e /clinic/<area>/<resource>
```
- **Rotas atuais → novas (redirecionamentos `Navigate replace`, mantidos até M14 fechar):**
  `/clinic` é a página Hoje (já implementada); pedidos em `/clinic/requests` (já implementado);
  `/clinic/agenda` (calendário), `/clinic/slots`, `/clinic/exams` e `/clinic/staff` mantêm-se; novas áreas usam rotas em inglês: `/clinic/patients`, `/clinic/services`, `/clinic/professionals`, `/clinic/finance`, `/clinic/reports`, `/clinic/settings`;
  sem redirecionamentos para já (as rotas existentes não mudam);
  `/clinic/login` mantém-se. Guardas `RequireClinicAuth`/papel (`flows.test.tsx` testa `/clinic/staff`: atualizar testes com o redirecionamento, não apagar).
- **Migração:** (1) criar shell novo com os mesmos ecrãs montados nas rotas novas; (2) redirecionamentos das rotas antigas; (3) mover páginas para `pages/clinic/<área>/` (sem mudar lógica); (4) só depois novas funcionalidades por fase.

### 3.5 Ordem de entrega (decidida pelo proprietário) e modo mock
| Passo | Conteúdo | Fase | Backend |
|---|---|---|---|
| 1 | Shell (6 itens, pesquisa única, redirecionamentos, responsivo) + **Hoje** com 3 ações rápidas | F0 | API atual (nenhuma dependência) |
| 2 | **Serviços**: tipos de consulta (duração, preço) e profissionais | (a) | mock; real após contrato de (a) |
| 3 | **Agenda por profissional** com regras de horários, bloqueios, lista de espera | (a) | mock |
| 4 | **Pacientes da clínica** + consentimento (ficha, convite, 2 níveis) | (a)/(d) | mock |
| 5 | **Confirmação ativa e faltas** (lembretes, indicadores, retorno) | (b) | mock; real depende de OP-07/OP-22 |
| 6 | **Recibos** (e comprovativos) | (e) | mock |
| depois | Fila/check-in/QR/pré-consulta (c); `CLINIC_DOCTOR`, perfil público (f) | (c), (f) | mock |
Tudo pode ser entregue em mock (MSW, `mocks/handlers/clinic/*`) para validar UX; **DPA/AIPD não bloqueiam o desenvolvimento em mock** mas são gate de lançamento. Mock nunca substitui testes de autorização/isolamento do backend.

## 4. Pontos em aberto
Nenhum: OP-24..30 foram decididos (ver `open-points.md`, Resolvidos). Resta o gate jurídico de lançamento (DPA, AIPD, Lei 22/11).
