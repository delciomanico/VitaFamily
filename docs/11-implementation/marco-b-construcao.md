# Marco B — plano de construção (S4 Autorizações, com `Process` e Despesa unificada)

> **Revisão 2026-11-14 (decisões do proprietário após parecer de revisor independente de clareza/complexidade):** (1) módulo `processes` próprio com tabela própria (vista derivada rejeitada; salvaguardas adotadas); (2) **Despesa unificada e migração do `ReimbursementClaim` sobem do marco C para o B** (fatia 2b); (3) papel `SUPERVISOR` criado já; (4) estados simplificados (§6); (5) requisitos de engenharia (§7); (6) donos provisórios (§3); (7) roteiro de usabilidade (Anexo A). O texto anterior mantém-se onde não foi explicitamente alterado; onde há conflito, vale esta revisão (§6–§7).

> **Estado:** autorizado pelo proprietário em **2026-11-14** ("pode avançar para construção, junto com um agente que verifica se o fluxo é claro e simples para humanos. Critérios: facilidade de uso, complexidade oculta no código, flexibilidade e legibilidade, bem como possibilidade de expansão"). Aceita ADR-029..032 **com âmbito limitado** (§1). **Nada de contrato foi alterado por este documento**: `openapi.yaml`, `schema.md`, `entities.md` e `modules.md` §3 mantêm-se; o contrato é o **primeiro passo da fatia 1** (§4, "Contrato primeiro"), feito num passo seguinte pelo `vita-architect`.
> Fontes: `00-product/process-flows.md` (§10 decisões, §13 modelo `Process`), `04-domain/state-machines.md` (S4 proposta, `family_status`), `plan.md` §4 (marco B), ADR-029..032, `00-product/business-model.md` §7.

## 1. Registo da autorização, defaults conservadores e bloqueios

### 1.1 O que fica aceite (âmbito de construção)
ADR-029 (software de ligação, não TPA; seguradora decide e paga; copagamento no balcão, o Vita só calcula e mostra), ADR-030 (só a Convenção mínima necessária e o prestador sem seguradora), ADR-032 (módulo `processes`, `Process` universal, `family_status` derivado, prazos 24–120 h/48 h, recurso 15 dias/72 h) e as decisões de 2026-11-14 já registadas em `process-flows.md` §10.1 (Q-U1, Q-C1, Q-P1..P3, Q-S1/S1b/S2/S3, Q-A1, Q-T1, Q-V1). ADR-031 reconhecido, **sem construção** neste marco.

### 1.2 Defaults conservadores (valem até decisão expressa do proprietário)
| Ponto pendente | Default aplicado | Efeito na construção |
|---|---|---|
| **C2** (mínimo de dados clínicos para a seguradora) | O pedido de autorização do marco B leva **só serviço (catálogo) + justificação administrativa** (texto livre curto, sem campo de diagnóstico). **Sem diagnóstico nem dados clínicos.** | Nenhum campo `diagnosis*` em contrato/schema; BR-SEG-18/23 e TC-SEG-08 mantêm-se. A justificação tem de ter aviso na UI ("não escreva dados clínicos") e teste de não-vazamento. |
| **D29** (consentimento por guia com diagnóstico) | **Diferido.** Não se constrói consentimento por guia nem campo de diagnóstico. | Fora das fatias 0–6. Reavaliar só após decisão de C2/D29. |
| **Q-V2** (prazo com consequência, 1 h urgente) | Opção **(A)**: manter a decisão anterior — **nunca aprova por silêncio**; 48 h por omissão (24–120 h configurável); escalada ao `SUPERVISOR`. Sem "prestador pode avançar". | Fatia 4 só implementa escalada; sem prazo de 1 h. |
| Carteira Apple/Google | **Depois** do cartão na app (`digital-card.md`). | Fora do marco B. |
| Endpoint público da rede (`/public/providers`, C6) | **Fora** até decisão. Não se cria nem se altera `GET /public/partners`. | Fora. |

### 1.3 Continua bloqueado (e porquê)
| Item | Bloqueio |
|---|---|
| ~~Despesa unificada, S5, migração do `ReimbursementClaim`, BR-INS-05 nova redação, fase "contrair"~~ | **ANTECIPADO para o marco B (fatia 2b), decisão do proprietário 2026-11-14.** Continuam no marco C apenas: S5 completo para além do núcleo (§6), medição/faturação (C9) e a fase "contrair" **só depois** de verificadas contagens/somas em dados reais. BR-INS-05 nova redação entra no contrato da fatia 2b (aprovação expressa já dada pela decisão). |
| Empresa fase 2 (ADR-031) | C1, C10, k mínimo e entidade por decidir. |
| Fases D (segurança medicamentosa), E (assistente de sintomas), F (wearables/incentivos) | C3, C4, C1/C7: exigem ADR próprio, validação clínica/AIPD/parecer. |
| Medição/faturação por transação | C9 e parecer fiscal/ARSEG. |
| Preços e modelo comercial | Hipótese não validada (ADR-029). |
| Ligação a registos de clínica sem ids Vita (BR-CLN-24) | A rever antes de migrar; fatia 1 só liga a marcação/atendimento que já têm ids Vita. |
| Salvaguardas de recurso (N-ésimo recurso, §11a) | Por decidir; fatia 3 implementa recurso sem limite fixo como decidido (Q-S2), sem salvaguardas extra. |
| Papel `SUPERVISOR` | **Criado já (decisão 2026-11-14).** `authorization.md` §8.2c **a marcar como aceite no contrato da fatia 4** (não editado até lá; `authorization.md` tem alterações da Fase A pendentes). Dono: `vita-identity`. Parecer jurídico geral (ARSEG, Lei 22/11) continua pendente e não bloqueia o código, bloqueia o **piloto com dados reais**. |

## 2. Princípios de engenharia (critérios do proprietário) e checklist por fatia
Cada fatia só fecha quando a lista abaixo está verificada (o agente de verificação de fluxo, §2.5, assina a secção 2.1; `vita-qa-security` a 2.2–2.4 em testes de arquitetura quando automatizáveis).

### 2.1 Facilidade de uso (poucos passos, vocabulário único)
- [ ] Cada fluxo novo tem o **nº de passos/ecrãs** declarado na fatia e não excede o declarado (ex.: pedir autorização: ≤ 4 passos para o prestador; ver estado: 0 passos extra, está no cartão do processo).
- [ ] **Vocabulário único**: termos de UI = `glossary.md` (guia, autorização, processo, estado). Nenhum sinónimo novo; termos novos entram no glossário na mesma fatia.
- [ ] A família vê **um** estado simples (`family_status`), nunca estados internos S4.
- [ ] Mensagens de erro em linguagem do utilizador, com o próximo passo (`errors.md`: código estável + `message` humano).
- [ ] Percurso feliz e 2 percursos de erro percorridos pelo agente de verificação, que devolve "claro/não claro" por ecrã.

### 2.2 Baixa complexidade oculta
- [ ] **Regras de negócio explícitas** em `domain/` como funções puras com nome do domínio (`podeAutoAprovar`, `calcularPrazoDecisao`); sem regras em controladores, repositórios ou SQL.
- [ ] **Sem lógica em triggers/default de BD** nem estados implícitos: todo o estado muda por transição nomeada; eventos de auditoria por transição.
- [ ] **Uma máquina de estados por entidade**, centralizada num só ficheiro de `domain/`, com tabela de transições e testes que percorrem **todas** as transições legais e rejeitam as ilegais.
- [ ] `family_status` é **função pura derivada** (sem coluna escrita à mão), com tabela-verdade testada.
- [ ] **Configuração em dados, não em código**: catálogo de serviços, "exige autorização", teto, prazo, regras de auto-aprovação vivem em tabelas/config por seguradora/plano; nenhum `if (serviceCode === ...)`.
- [ ] Efeitos (notificações, prazos) saem por **eventos/outbox ou jobs idempotentes** nomeados, não por chamadas encadeadas escondidas.

### 2.3 Flexibilidade e legibilidade
- [ ] Nomes do domínio consistentes com `conventions.md` (identificadores de código em inglês como no schema; texto de UI e docs em pt); sem mistura no mesmo conceito.
- [ ] Funções curtas (um motivo para mudar); casos de uso = 1 ficheiro, 1 ação; ficheiros que cresçam além do razoável dividem-se (ADR-016).
- [ ] **Portas/adaptadores** onde há ferramenta externa ou fronteira entre módulos (ADR-015/016); `interface`/`infrastructure` nunca importadas por `domain`/`application`; teste de arquitetura (`tests/architecture-rules.ts`) cobre o novo módulo.
- [ ] Contrato (`openapi.yaml`) e testes são a documentação: nome de teste = regra de negócio (`BR-AUT-06 escala ao Supervisor...`).

### 2.4 Possibilidade de expansão
- [ ] **Novo tipo de guia / serviço / regra de auto-aprovação / prazo = linha de dados ou nova regra registada**, sem migração de código nem alteração de máquina de estados (verificado por um teste que adiciona um tipo de guia fictício só em dados).
- [ ] Enumerações do domínio abertas à extensão via catálogo (tipo de guia, tipo de despesa) e não em `CHECK` rígido onde o proprietário prevê crescimento.
- [ ] **Fronteiras entre módulos**: `processes` referencia por id e agrega estado por portas; **não** importa `insurance`/`insurer-ops`/`appointments` diretamente (dependências em `modules.md` §3, atualizadas no contrato).
- [ ] Colunas `process_id` nullable e sem FK composta (ADR-032), para que o marco C (Despesa) encaixe sem reescrever o B.
- [ ] Nada que o marco C/empresa precise de desfazer: sem campos clínicos (default C2), sem `family_status` persistido.

### 2.5 Agente de verificação do fluxo (humanos)
Em cada fatia com UI, após o contrato e antes de fechar, um agente independente (não o implementador) percorre o fluxo com o critério 2.1 e devolve: nº de passos, termos novos, pontos de confusão, e se algum estado interno vaza. Sem este parecer a fatia não fecha. (Proposta: papel exercido pelo `vita-qa-security` em modo "revisão de fluxo", ou agente dedicado; decisão do proprietário.)

## 3. Donos (agentes) — proposta provisória de 2026-11-14 (o proprietário não objetou; formalizar em `.claude/agents/` pelo proprietário)
**Provisório:** `vita-health` = `processes` e `insurer-ops`; `vita-alerts` = jobs e notificações; `vita-identity` = papel `SUPERVISOR`; **revisão de fluxo por fatia com interface** = agente independente (Plan ou `vita-qa-security`), nunca o implementador. O texto abaixo é o histórico da lacuna.
`.claude/agents/` **não atribui** `insurance`, `insurer-ops`, `clinic-*` nem o novo `processes` a nenhum agente (`vita-health` tem `appointments`, `clinics`, `examinations`; `vita-lifecycle` tem `reports/lifecycle/admin`; `vita-alerts` alertas/notificações). **Lacuna a decidir pelo proprietário.** Proposta:
- `processes` (novo): **`vita-health`** (adjacente a `appointments`/`examinations`, que são as primeiras ligações) — ou novo agente `vita-process`. Recomendo `vita-health` no arranque.
- `insurer-ops` (autorizações, catálogo, planos): **atribuir a `vita-health`** até haver agente próprio (já é quem toca `clinics`, origem do pedido); alternativa `vita-lifecycle` (tem `admin`, que gere seguradoras). Pede-se decisão e atualização de `.claude/agents/`.
- Notificações e prazos: `vita-alerts` (jobs/scanner idempotente, ADR-009).
- Papéis, claims, `AccessPolicy`, auditoria: `vita-identity`/`vita-platform` (conforme módulo `access`/`audit`).
- Contratos, ADR, docs: `vita-architect` (único a editar `docs/`). Testes e segurança: `vita-qa-security`. Web: agente do `apps/web` (por definir; hoje sem dono em `.claude/agents/`).

## 4. Fatias verticais
Regra geral: **contrato primeiro** (arquiteto edita docs/openapi/schema; depois `pnpm gen`; só então código). Cada fatia é entregável e testável isoladamente, fecha com `pnpm gen && lint && test && build`, conformidade OpenAPI, teste de arquitetura e a checklist de §2. **Contratos tocados = lista mínima** (todos passam pelo `vita-architect` e por change control quando alteram regras aprovadas).

### Fatia 0 — Consolidar Fase A (pré-requisito, sem código novo)
- **Objetivo:** base estável antes de acrescentar.
- **Bloqueia o arranque:** alterações pendentes de Fase A por commitar/rever em `apps/api` (insurance, clinics, platform, audit) e docs (`business-rules.md`, `authorization.md`, `openapi.yaml`, `schema.md`, `modules.md`, `insurer-phase-a.md` não versionado); pendências de QA/segurança da Fase A (`insurer-phase-a.md`); princípio de dados de §3.4 escrito em `privacy.md` antes do piloto; `make test` verde. Piloto com dados reais depende de parecer jurídico (§1.3).
- **Critério de saída (explícito, 2026-11-14):** `pnpm gen`, `pnpm lint`, `pnpm test` e `pnpm build` **verdes** e **commit** da Fase A; sem isso nenhum contrato novo é escrito.
- **Critério de aceitação:** árvore limpa e commitada, testes verdes, `docs/` e código sem divergências (revisão do arquiteto); lista de pendências Fase A fechada ou explicitamente adiada.
- **Dono:** quem tem as alterações Fase A (a confirmar) + `vita-qa-security`; docs `vita-architect`.
- **Fora:** qualquer funcionalidade nova.

### Fatia 1 — Módulo `processes` + `Process` mínimo (todo o ato tem Process)
- **Objetivo:** cada marcação/atendimento existente tem um `Process` (com ou sem seguradora, **tabela própria**) e um `family_status` calculado por `deriveFamilyStatus(facts)`.
- **Salvaguardas do revisor (obrigatórias):** `deriveFamilyStatus(facts)` é **função pura** com tabela de verdade testada; os módulos de origem publicam **factos pequenos e estáveis** ("ato avançou: fase, quando") por porta/evento; **sem acoplamento bidirecional amplo** (`processes` não importa módulos de origem e estes não importam `processes`). Estado visível à família = **4 valores** (§6).
- **Critério de aceitação:** criar `Appointment`/atendimento gera `Process` com `processId` único; a família lista os seus processos com `family_status` (`SCHEDULED | IN_PROGRESS | DONE | CANCELLED`, apresentados "Marcado / A tratar / Feito / Cancelado") e **uma frase "o que falta e de quem"**, ambos calculados por função pura; isolamento por vínculo (404 sem enumeração); backfill idempotente dos atos existentes.
- **Módulos tocados:** `processes` (novo), `appointments`/`examinations` (emitir o facto por porta/evento; **não** importar `processes`), `access` (leitura por vínculo), `audit` (`process.*`).
- **Contrato (primeiro passo):** `openapi.yaml` (`GET /families/{id}/processes`, `GET /processes/{id}`), `endpoints.md`, `errors.md`, `schema.md` (`processes`; `process_id` nullable nas tabelas ligadas; `family_status` **derivado** pela função pura, não escrito à mão), `entities.md`, `modules.md` §3 (linha, dependências, nota), `state-machines.md` (mapeamento `family_status`, já proposto), `authorization.md` (matriz de leitura), `audit.md`, `acceptance-criteria.md`/`test-cases.md` (TC novos). **Marcados como aceites no âmbito da fatia 1 (alteram regras: BR-AUT-01 e Q-P3).**
- **Migração:** nova (números após `0034`): `processes` + colunas `process_id` NULL + backfill idempotente; reversível.
- **Testes:** unidade (derivação `family_status`, tabela-verdade), integração (criação, backfill, isolamento), HTTP contrato, arquitetura (sem imports cruzados).
- **Portal/app:** app da família: lista simples de processos (Início/Histórico); portal da clínica: vê o `processId` do seu ato. Passos: 0 novos para a família (estado visível).
- **Dono:** `vita-health` (proposto). Depende de: fatia 0.
- **Fora:** autorização, despesa, seguradora, registos de clínica sem ids Vita (BR-CLN-24).

### Fatia 2 — Catálogo (`service_kind`), política da seguradora e moeda
- **Acrescentado 2026-11-14:** catálogo em dados `service_kind` por seguradora (`guideType` consulta|serviços|internação + `expenseType`); tabela `insurer_policy_settings` com mínimo/máximo do Vita e valor por seguradora (decisão 24–120 h, 48 h por omissão; recurso 15 dias/72 h; falta de informação 7 dias; urgência 48 h) **em vez de constantes**; **corrigir a moeda por defeito (EUR vs AOA) antes da migração da fatia 2b**, com **única fonte = moeda da seguradora** (teste que falha se houver outra fonte). Função única `evaluateCoverage(plan, beneficiary, service, date)` introduzida aqui (§7).
- **Objetivo:** a seguradora configura, em dados, que serviços exigem autorização, teto e prazo.
- **Critério de aceitação:** catálogo com tipos **I, P, C, EAD, T, E, PO, M, SD** (extensível por dados); por plano: `requiresAuthorization`, teto, prazo de decisão (24–120 h, **48 h por omissão**, validado por mín./máx. do Vita); fora do intervalo ⇒ `VALIDATION_ERROR`; alterações auditadas.
- **Módulos:** `insurer-ops` (planos/serviços), `audit`; leitura do catálogo exposta por porta a `processes`/pedido.
- **Contrato:** `openapi.yaml` (rotas de catálogo e config do plano no portal da seguradora), `endpoints.md`, `errors.md`, `schema.md` (`expense_types` ou catálogo; colunas em `plan_coverages`/`insurer_services`), `entities.md`, `modules.md`, `authorization.md` (quem edita), `audit.md`, `business-rules.md` (BR-AUT-06/Q-V1 já decididas), testes de aceitação.
- **Migração:** nova (seed dos 9 tipos; colunas de config com defaults 48 h).
- **Testes:** unidade (validação de prazo, mín./máx.), integração, isolamento entre seguradoras, "novo tipo por dados" (§2.4).
- **Portal:** portal da seguradora (configuração do plano). Passos: editar 1 campo por regra.
- **Dono:** a decidir (§3; proposto `vita-health`). Depende de: fatia 0 (pode correr em paralelo à 1).
- **Fora:** despesa/S5, tabela de preços, convenção para além do mínimo.

### Fatia 2b — Despesa unificada (`origin` PROVIDER | FAMILY) e migração do `ReimbursementClaim` (NOVA, antecipada do marco C)
- **Objetivo:** uma só entidade de despesa com fila única; `ReimbursementClaim` migra para origem `FAMILY`.
- **Critério de aceitação:** núcleo `SUBMITTED → IN_REVIEW → APPROVED | REJECTED | RETURNED → PAID` (`validada` = flag `autoChecked`, não estado; `PAID` registado pela seguradora, nova redação de BR-INS-05); **origem FAMILY aceita no mínimo "valor + anexos"**; tipo de despesa, NIF, motivo e linhas são **opcionais ou preenchidos pela seguradora**; a família **nunca** escolhe I/P/C/EAD/T/E/PO/M/SD; fachada compatível para o contrato atual de reembolsos durante a transição.
- **Contrato (primeiro passo):** `openapi.yaml`, `endpoints.md`, `errors.md`, `schema.md` (tabela de despesa, `origin`, `process_id` nullable), `entities.md`, `state-machines.md` (S5 núcleo), `business-rules.md` (BR-INS-05), `authorization.md`, `audit.md`, test-cases. Escrito **só depois** de a Fase A (fatia 0) estar commitada.
- **Migração expand/backfill/fachada/contrair (4 passos, cada um reversível até ao último):** (1) **expand** — nova tabela e colunas nullable, sem tocar a antiga; (2) **backfill** idempotente com `id` preservado (recibos e anexos incluídos); (3) **fachada** — a API antiga lê/escreve a nova tabela; dupla verificação; (4) **contrair** — remover a antiga **só** depois de os testes de **contagens e somas** (por família, por estado, por moeda; totais antes = depois) passarem em cópia de dados reais e o proprietário o autorizar. Pré-requisito: moeda corrigida (fatia 2).
- **Testes:** unidade (máquina núcleo, todas as transições), integração (backfill idempotente, contagens/somas), HTTP contrato e fachada, regressão TC-INS, arquitetura, isolamento entre seguradoras e entre famílias.
- **Portal/app:** app da família (pedir reembolso: valor + anexos, ≤ 3 passos, sem termos técnicos); portal da seguradora (fila única).
- **Dono:** `vita-health` (provisório); migração revista por `vita-qa-security`. Depende de: 1, 2.
- **Fora:** medição/faturação (C9), contrair sem verificação, campos clínicos.

### Fatia 3 — Pedido de autorização pelo prestador (3 tipos de guia, estados S4)
- **Objetivo:** a clínica pede autorização ligada a um `Process`.
- **Acrescentado 2026-11-14:** pedido **pré-preenchido com o tipo de guia deduzido do serviço** (`service_kind`); botão único **"Concluir ato"** na clínica (relatório + recibo + despesa, origem PROVIDER); elegibilidade como **semáforo** (verde/amarelo/vermelho); verificação via `evaluateCoverage`; estados §6 (sem estado `AUTO_APPROVED`, `EXPIRED`, `USED`, `PARTIAL`).
- **Critério de aceitação:** tipos de guia **consulta / serviços-exames / internação** (como dados); pedido com serviço do catálogo + **justificação administrativa** (default C2: sem diagnóstico); estados S4 simplificados (§6; `falta de informação` caduca em 7 dias como `closedReason = INFO_TIMEOUT`, recurso = novo pedido ligado ao anterior, vários, prazo 15 dias após recusa); anexo só administrativo; `family_status` do `Process` reflete `IN_PROGRESS` com a frase "o que falta e de quem"; prestador vê só sim/não e copagamento (Q-T1).
- **Módulos:** `insurer-ops` (`AuthorizationRequest`, máquina S4 centralizada), `processes` (por porta), `clinics`/portal da clínica, `audit`.
- **Contrato:** `openapi.yaml` (`/clinic-portal/authorizations*`), `endpoints.md`, `errors.md`, `schema.md` (`authorization_requests.process_id`, `guide_type`, `parent_request_id`), `entities.md`, `state-machines.md` (S4 passa de proposta a vigente para o escopo), `business-rules.md` (BR-AUT-01..08, BR-SEG-03/05; emenda UC-SEG-07), `authorization.md`, `audit.md`, `privacy.md` (justificação sem dados clínicos), acceptance/test-cases (inclui TC-SEG-08 de não-vazamento).
- **Migração:** nova (campos novos nullable, sem quebrar `AuthorizationRequest` existente).
- **Testes:** unidade (máquina: todas as transições legais/ilegais), integração, HTTP, privacidade (sem dados clínicos na resposta/anexos), arquitetura.
- **Portal:** portal da clínica (pedir ≤ 4 passos); estado visível no portal e na lista de processos.
- **Dono:** a decidir (§3). Depende de: 1, 2.
- **Fora:** diagnóstico/consentimento por guia (D29), urgência (fatia 6), decisão pela seguradora (fatia 4).

### Fatia 4 — Fila e decisão pela seguradora; auto-aprovação; escalada SLA
- **Objetivo:** `AUTHORIZATION_ANALYST` decide; regras simples auto-aprovam; atraso escala ao `SUPERVISOR` (papel criado nesta fatia; `authorization.md` §8.2c a marcar aceite no contrato).
- **Acrescentado 2026-11-14:** auto-aprovação = **lista ordenada de predicados puros `AutoApprovalRule[]`** que devolvem `{ok, reason}`; a razão é mostrada ao analista; resultado = `APPROVED` com `decidedBy = SYSTEM|ANALYST`; SLA/escalada = relógios/flags (`due_at`, `escalated_at`), não estados; limites lidos de `insurer_policy_settings`.
- **Critério de aceitação:** fila ordenada por prazo; decisão (aprovar com teto/`validUntil`, recusar com motivo, pedir informação); auto-aprovação só se **serviço coberto, beneficiário elegível, dentro do teto, sem carência** (Q-A1) e reversível; `SLA_BREACH` ao passar o prazo, escalando ao `SUPERVISOR`, aviso ao prestador, **nunca aprova por silêncio** (Q-V2 A); separação de funções (quem analisa ≠ quem supervisiona); falta de comparência não cancela (Q-S3).
- **Módulos:** `insurer-ops` (decisão, regras, job `insurer.expire-authorizations` e job de SLA), `access`/`authorization` (papel `SUPERVISOR`), `alerts`/`notifications` (aviso), `audit` (`SLA_BREACH`, `AUTH_ESCALATED`).
- **Contrato:** `openapi.yaml` (fila, decisão, supervisão), `endpoints.md`, `errors.md`, `schema.md` (eventos imutáveis, reserva de saldo, SLA), `authorization.md` (**`SUPERVISOR` §8.2c passa de proposto a aceite**, matriz), `audit.md`, `business-rules.md` (BR-AUT-03/06, BR-SEG-16), `state-machines.md`, acceptance/test-cases (isolamento entre seguradoras, BR-SEG-1x).
- **Migração:** nova (reservas, SLA/escalada, papel).
- **Testes:** unidade (`podeAutoAprovar`, cálculo de prazo, relógio injetável), integração (jobs idempotentes), isolamento, concorrência da reserva de saldo, segurança (papéis).
- **Portal:** portal da seguradora (fila única de autorizações, vista do Supervisor); clínica recebe notificação.
- **Dono:** a decidir (§3); notificações/jobs `vita-alerts`; papel `vita-identity`. Depende de: 3.
- **Fora:** despesas, regras de auto-aprovação por histórico/rede/risco (rejeitado, Q-A1), prazo de 1 h (Q-V2 B).

### Fatia 5 — Vista da família (estado simples e notificações)
- **Objetivo:** a família vê o estado do seu processo e é avisada, sem saber de S4.
- **Critério de aceitação:** `family_status` + saldo e tetos/consumo (Q-T1) + copagamento estimado ("o Vita só calcula e mostra", Q-C1) no cartão do processo; notificação (in-app/e-mail conforme `notifications`) em mudanças relevantes; sem motivos clínicos, sem estados internos.
- **Módulos:** `processes` (leitura), `notifications`, `families`/`access`, `insurer-ops` (via porta, só saldo/teto do beneficiário ligado e consentido).
- **Contrato:** `openapi.yaml` (campos de saldo/estimativa na vista de processo), `endpoints.md`, `authorization.md`, `privacy.md`, `business-rules.md` (BR-AUT-11, BR-DSP-02 estimativa; **pré-cálculo é proposta §11a pendente: só se o proprietário a aprovar, caso contrário fica fora**), test-cases.
- **Migração:** provável nenhuma (leitura/derivação).
- **Testes:** unidade, HTTP, privacidade (família só vê o seu), notificação idempotente.
- **App:** app da família (cartão do processo, centro de notificações); passos extra: 0.
- **Dono:** `vita-health` (processes) + `vita-alerts` (notificações). Depende de: 1, 3 (4 para saldo real).
- **Fora:** carteira Apple/Google, cartão digital completo, pagamento.

### Fatia 6 — Urgência (aviso em 48 h, revisão manual)
- **Objetivo:** atender primeiro; regularizar a posteriori.
- **Critério de aceitação:** prestador regista atendimento urgente sem autorização prévia; tem de notificar a seguradora **em 48 h**; falhado o prazo ⇒ `URGENT_NOTIFY_OVERDUE` e **revisão manual, nunca recusa automática** (BR-AUT-05, Q-U1).
- **Módulos:** `insurer-ops` (exceção em UC-SEG-10/BR-SEG-10), `processes`, `alerts` (scanner), `audit`.
- **Contrato:** `openapi.yaml`, `endpoints.md`, `errors.md`, `business-rules.md` (**emenda a BR-SEG-10 e UC-SEG-10, proposta §11a: depende da aprovação expressa; o proprietário já decidiu a direção Q-U1**), `state-machines.md`, `schema.md`, `audit.md`, test-cases.
- **Migração:** nova (flag urgência, `notifiedAt`).
- **Testes:** unidade (prazo 48 h com relógio injetável), integração (scanner idempotente), regressão do comportamento não urgente de BR-SEG-10.
- **Portal:** portal da clínica (marcar "urgência", 1 passo extra); seguradora vê fila de regularização.
- **Dono:** a decidir (§3), `vita-alerts` para o scanner. Depende de: 3, 4.
- **Fora:** prazo de 1 h (Q-V2 B), despesa.

### Dependências
`0 → 1`, `0 → 2` (1 e 2 paralelas), `1+2 → 2b`, `1+2 → 3 → 4 → 5` (3 e 2b podem correr em paralelo), `3+4 → 6`. Ordem de entrega: 0, 1, 2, 2b, 3, 4, 5, 6. Marco C = S5 para além do núcleo, medição (C9), "contrair" após verificação, e o que está bloqueado em §1.3.

## 5. Próximo passo
**Fatia 0 primeiro** (critério de saída: `pnpm gen`, `lint`, `test`, `build` verdes **e** commit da Fase A; só então o contrato). Depois, **contrato da fatia 1 pelo `vita-architect`** (openapi.yaml, endpoints.md, errors.md, schema.md, entities.md, modules.md, authorization.md, audit.md, test-cases). Até a Fase A estar commitada **não** se altera `openapi.yaml`, `endpoints.md`, `errors.md`, `schema.md`, `entities.md`, `modules.md` nem `authorization.md`. Após o contrato: `pnpm gen`, migração, código do `vita-health` (proposto), revisão de fluxo (§2.5).

## 6. Estados simplificados (decisão 2026-11-14)
Identificadores em **inglês**; tradução só na apresentação (`lib/labels.ts`, §7).
- **`Process.family_status` visível = 4:** `SCHEDULED` (Marcado), `IN_PROGRESS` (A tratar), `DONE` (Feito), `CANCELLED` (Cancelado), **mais uma frase "o que falta e de quem"** (ex.: "A seguradora está a analisar; resposta até quinta"). Os 7 valores propostos antes (`AGENDADO … CONCLUIDO`) ficam como histórico.
- **Autorização:** `AUTO_APPROVED` = `APPROVED` com `decidedBy = SYSTEM|ANALYST`; "aprovada em parte" = `APPROVED` com `authorizedAmount < requestedAmount` (derivado na UI); `usada`/`expirada` = derivados ou `closedReason`; **`INFO_TIMEOUT` = `closedReason` explícito**; SLA, escalada e urgência atrasada = **relógios/flags** (`due_at`, `escalated_at`, `urgentNotifiedAt`), não estados; recurso e contestação = **novo pedido ligado ao anterior** (`parent_request_id`, mesmo padrão).
- **Despesa (núcleo):** `SUBMITTED → IN_REVIEW → APPROVED | REJECTED | RETURNED → PAID`; `validada` = flag `autoChecked`.

## 7. Requisitos de engenharia adotados (parecer do revisor)
1. **`evaluateCoverage(plan, beneficiary, service, date)`**: UMA função de domínio, usada por pré-cálculo, verificação na clínica, auto-aprovação e despesa. Proibidas cópias da lógica.
2. **`AutoApprovalRule[]`**: lista ordenada de predicados puros `{ok, reason}`; razão visível ao analista.
3. **Catálogo em dados:** `service_kind` (`guideType` + `expenseType`) por seguradora.
4. **`insurer_policy_settings`:** mínimo/máximo do Vita e valor por seguradora (decisão 24–120 h, 48 h por omissão; recurso 15 dias/72 h; falta de informação 7 dias; urgência 48 h); sem constantes no código.
5. **`channel`** como atributo do evento (`PORTAL|PHONE|WHATSAPP|PHOTO|API`) com `recordedBy`.
6. **Rótulos/vocabulário pt-AO** centralizados em `apps/web/src/lib/labels.ts` com **duas variantes** (família e profissional); remover mapas duplicados.
7. **Fronteira `insurance` vs `insurer-ops`** documentada nos READMEs dos dois módulos.
8. **UX:** botão único "Concluir ato" (relatório + recibo + despesa); elegibilidade como semáforo; pedido pré-preenchido com guia deduzida do serviço.
9. **Vocabulário da família:** nunca "autorização/despesa/glosa/elegibilidade/sinistro" no ecrã da família (teste automático sobre a app da família).
10. **Salvaguarda da despesa FAMILY:** família nunca escolhe tipo de despesa (fatia 2b).
11. **Checklist por fatia (§2) mantém-se** e cada item novo acima entra como verificável na fatia que o introduz.

## Anexo A — Roteiro de teste de usabilidade (do revisor)
- **Participantes:** 5 por perfil (família com 1 titular e 1 cuidador; recepcionista de clínica; analista de seguradora), sem formação prévia.
- **Tarefas (família):** (1) marcar uma consulta; (2) ver em que ponto está o processo e o que falta; (3) pedir reembolso com valor + foto do recibo; (4) encontrar o cartão do beneficiário.
- **Tarefas (clínica):** (1) verificar elegibilidade (semáforo); (2) pedir autorização para um serviço; (3) concluir o ato com "Concluir ato"; (4) registar um atendimento urgente.
- **Tarefas (seguradora):** (1) localizar o pedido mais atrasado; (2) aprovar com teto; (3) pedir informação; (4) ver a razão da auto-aprovação.
- **Teste dos 5 segundos:** mostrar o cartão do processo 5 s e perguntar "o que está a acontecer? o que falta? de quem?"; **≥ 4 em 5** respondem certo.
- **Métricas:** taxa de sucesso por tarefa, tempo, nº de passos vs declarado, erros, perguntas ao moderador; questionário **SUS**.
- **Critério de aprovação:** **SUS ≥ 75** e **0 erros críticos** (erro crítico = ação irreversível errada, ou vazamento de termo/estado interno à família). Falhou ⇒ corrigir e repetir antes de fechar a fatia.
- **Quando:** por fatia com interface (3, 4, 5, 6 e 2b), por agente independente + sessão com utilizadores antes do piloto.
