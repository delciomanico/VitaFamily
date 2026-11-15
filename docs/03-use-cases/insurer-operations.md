# Casos de uso — Módulo operacional de seguradoras (ADR-025)

> Estado: **v0.1 (2026-11-05, D21)** — convenções comuns em `family.md`. Regras: `business-rules.md` §15 (BR-SEG-01..23). Papéis e matriz: `authorization.md` §8.2b/§8.4/§8.5. Estados: `state-machines.md`. Só para seguradoras com módulo operacional ativo (`operational_module_enabled`). Todo o acesso fora dos limites do papel/`insurerId` é `DENIED`/`NOT_FOUND` e auditado. Erros e paginação: `errors.md`/`api-overview.md`; `Idempotency-Key` nas submissões da clínica. Contrato `openapi.yaml`: **Fase A redigida em 2026-11-11** (S1, S2/S3/S6 parciais); S4–S5 ainda só esboço em `endpoints.md`.

### UC-SEG-01 Gerir empresas
- **Ator:** `BENEFICIARY_MANAGER`, `INSURANCE_ADMIN` · **BR:** BR-SEG-14/15 · **Fluxo:** criar/editar/inativar empresa cliente (nome, NIF único por seguradora) → usada em apólices de grupo.
- **Alternativos:** NIF duplicado ⇒ `VALIDATION_ERROR`/`CONFLICT`; outros papéis só leem.

### UC-SEG-02 Registar/importar beneficiários e dependentes
- **Ator:** `BENEFICIARY_MANAGER`, `INSURANCE_ADMIN` · **BR:** BR-SEG-17/14/22 · **Fluxo (manual):** dados do beneficiário + titular (`holderId`) e relação → nasce `PENDING` → validação → `ACTIVE`. **Fluxo (importação):** carrega CSV/XLSX (≤ 5.000 linhas) → pré-visualização + relatório de erros por linha → confirma → transação por lote.
- **Alternativos:** documento de identificação duplicado ⇒ linha sinalizada (não duplica); lote > 5.000 ⇒ `VALIDATION_ERROR`; nunca ativa beneficiários sem validação. Confirmação de ligação paciente↔beneficiário (BR-SEG-20) também aqui.

### UC-SEG-03 Criar/gerir apólices
- **Ator:** `BENEFICIARY_MANAGER`, `INSURANCE_ADMIN` · **BR:** BR-SEG-01/04 · **Fluxo:** escolhe plano `ACTIVE`, titular, empresa (opcional), número único, `validFrom..validTo` → `DRAFT` → `ACTIVE`; suspender/cancelar com motivo.
- **Alternativos:** apólice a expirar passa a `EXPIRED` (sistema); alterar plano ativo ⇒ nova versão (UC-SEG-04).

### UC-SEG-04 Criar plano e coberturas
- **Ator:** `INSURANCE_ADMIN` · **BR:** BR-SEG-02/03/06/08/09/13/22 · **Fluxo:** cria plano (`DRAFT`) → define, por serviço da lista da seguradora, tipo `INCLUDED|LIMITED|EXCLUDED`, comparticipação, limites (beneficiário/família/ano), carência, `requiresAuthorization`, teto de auto-aprovação e tolerância → ativa.
- **Alternativos:** plano com apólices ativas é imutável (nova versão); serviço fora da lista da seguradora ⇒ `VALIDATION_ERROR`. Gere também a lista de serviços (`InsurerService`).

### UC-SEG-05 Validar elegibilidade (clínica/paciente)
- **Ator:** `CLINIC_ADMIN`/`CLINIC_MANAGER` (seguradora do cartão apresentado — Q4 decidida 2026-11-11) · **BR:** BR-SEG-01/02/04/18/23 · **Fluxo:** escolhe a seguradora ligada → indica nº de cartão, QR ou identificação (+ serviço) → sistema valida estado, apólice, datas, cobertura, carência, saldo e `requiresAuthorization` → devolve a resposta **mínima** → auditoria (finalidade: atendimento).
- **Alternativos:** não elegível/inexistente ⇒ resposta genérica sem revelar o motivo além do necessário; excesso de tentativas ⇒ `429`/`RATE_LIMITED`; seguradora a que a clínica não está ligada, suspensa ou sem módulo ativo ⇒ `NOT_FOUND` (BR-SEG-29); dependente avaliado pela apólice do titular (BR-SEG-30); só coberturas ACTIVE e não EXCLUDED, `waitingEndsOn` nulo sem carência (BR-SEG-31); na Fase A não há saldo. O paciente consulta a sua própria elegibilidade em UC-SEG-14/15. **Fatia 3 (BR-SEG-43, BR-AUT-11):** com um serviço da lista a resposta traz o **semáforo** (verde: coberto sem autorização; amarelo: pedir autorização; vermelho: não coberto) e o copagamento (`patientSharePct`), calculados por `evaluateCoverage`; nunca a razão nem o saldo; o botão «Pedir autorização» só aparece no amarelo.

### UC-SEG-06 Pedir autorização (reescrito na fatia 3 do marco B, ADR-034)
- **Ator:** `CLINIC_ADMIN`/`CLINIC_MANAGER` · **BR:** BR-AUT-01/02/06/09/12/13/16, BR-SEG-02/04/18/22/41/43 · **Fluxo (4 passos):** (1) identifica o cartão/QR/documento e escolhe o serviço da lista da seguradora → semáforo (UC-SEG-05); (2) «Pedir autorização» (pré-preenchido com seguradora, beneficiário, serviço e tipo de guia **deduzido** do serviço); (3) valor, data prevista e justificação **administrativa** (aviso «não escreva dados clínicos»; anexos administrativos opcionais; liga ao atendimento da agenda por `processId`); (4) submeter → `SUBMITTED` → `IN_REVIEW`; mostra «resposta até…» (`decisionDueAt`). O pedido fica ligado a um `Process` (do ato ou novo, BR-AUT-01).
- **Alternativos:** beneficiário não elegível/inexistente ⇒ `404` único; semáforo vermelho ou verde ⇒ `VALIDATION_ERROR` (sem razão); serviço por classificar sem tipo de guia ⇒ `VALIDATION_ERROR`; pedido em curso duplicado ⇒ `CONFLICT`; ligação da clínica inativa ⇒ `404`; sem diagnóstico em nenhum campo (C2). A decisão do analista e a auto-aprovação são da **fatia 4** (UC-SEG-07). **Fatia 4:** se as regras de auto-aprovação da seguradora se aplicam (BR-AUT-03), o pedido nasce já `APPROVED` (a resposta traz o código); a clínica não vê que foi automática.

### UC-SEG-07 Analisar e decidir autorização (**fatia 4, ADR-035; contrato fechado 2026-11-15**)
- **Ator:** `AUTHORIZATION_ANALYST` (pedidos normais) · `SUPERVISOR` (só recursos, reverter, reabrir) · **BR:** BR-SEG-03/04/05/16, BR-AUT-03/04/06/07/17/18/21/22 · **Fluxo (3 passos):** (1) abre o pedido da fila (UC-SEG-20): justificação administrativa, anexos, cobertura avaliada agora e, se houve, o rasto da auto-aprovação; (2) **aprova** (valor autorizado — omissão: o pedido —, validade — omissão: política —, nota se for em parte; gera o código), **recusa** (motivo) ou **pede informação** (motivo; define `infoExpiresAt`); (3) a clínica vê o resultado no seu pedido. Ao agir, o analista fica atribuído ao pedido. O `SUPERVISOR` decide **recursos** (mesmo fluxo) e pode **reverter** uma aprovação (`cancel`, motivo; a automática só ele) e **reabrir** uma recusa (`reopen`, motivo interno; dentro do prazo de recurso).
- **Alternativos:** carência ou limite esgotado: aprova-se com `overrideReason` interno (BR-SEG-04); cobertura entretanto **vermelha** ⇒ `422` (recusa-se); valor acima do pedido/saldo ⇒ `422`; pedido já decidido ou noutro estado ⇒ `409 INVALID_STATE_TRANSITION`; atribuído a outro analista ⇒ `409 CONFLICT`; analista num recurso, supervisor num pedido normal, ou quem decidiu a recusa de origem ⇒ `403`. **Não há** aprovação por silêncio nem por atraso. Sem reserva de saldo (ADR-035 §7).

### UC-SEG-08 Responder a pedido de informação (fatia 3)
- **Ator:** `CLINIC_ADMIN`/`CLINIC_MANAGER` · **BR:** BR-AUT-12/13/14 · **Fluxo:** vê o pedido `INFO_REQUESTED` com o motivo e o limite para responder (`infoExpiresAt`) → anexa documentos administrativos (opcional) → envia `message` administrativa → `IN_REVIEW` e novo `decisionDueAt`.
- **Alternativos:** pedido noutro estado ⇒ `INVALID_STATE_TRANSITION`; sem resposta até ao limite ⇒ `CANCELLED` com `closedReason=INFO_TIMEOUT` (job `insurer.expire-info-requests`); novo pedido pode reabrir o assunto. **Cancelar** (BR-AUT-15) e **recorrer** de uma recusa (BR-AUT-08) são as outras ações do prestador sobre o seu pedido.

### UC-SEG-09 Gerir rede de prestadores
- **Ator:** `INSURANCE_ADMIN` · **BR:** BR-SEG-14/18/22 · **Fluxo:** cria prestador (tipo, NIF), unidades, especialidades e serviços da lista da seguradora; liga opcionalmente a uma `Clinic` PARTNER (dá acesso ao portal da clínica para esta seguradora); suspende/reativa.
- **Alternativos:** clínica já ligada ⇒ `CONFLICT`; prestador `SUSPENDED` ⇒ a clínica deixa de validar/submeter. Preços/contratos: fase 2.

### UC-SEG-10 Registar atendimento
- **Ator:** clínica (`CLINIC_MANAGER` ou `CLINIC_ADMIN`, Q6) · **BR:** BR-SEG-10/22/23 · **Fluxo:** beneficiário validado, serviço, médico (texto), data, autorização (se exigida) → `Encounter`. **Sem diagnóstico** (Q5).
- **Alternativos:** serviço que exige autorização sem autorização válida ⇒ `VALIDATION_ERROR`.

### UC-SEG-11 Submeter despesa
- **Ator:** clínica · **BR:** BR-SEG-06/08/10/11/13 · **Fluxo:** escolhe atendimento, linhas (serviço, quantidade, valor), anexos → sistema valida apólice vigente na data e autorização → calcula `insurerShare`/`patientShare` (BR-SEG-06/08) → `SUBMITTED`; duplicado ou valor > autorizado (+ tolerância) ⇒ `IN_REVIEW` com flag.
- **Alternativos:** `Idempotency-Key`; atendimento já `DIRECT_BILLED` ⇒ `CONFLICT`.

### UC-SEG-12 Analisar despesa (aprovar/rejeitar/devolver)
- **Ator:** `CLAIMS_MANAGER` · **BR:** BR-SEG-07/11/12/13/21 · **Fluxo:** assume (`IN_REVIEW`) → aprova (reserva → `used`; autorização `USED`; atendimento `DIRECT_BILLED`; no MVP termina em `APPROVED`, valor a pagar) / rejeita (motivo) / devolve (motivo, `RETURNED`).
- **Alternativos:** duplicado nunca é rejeitado automaticamente; decisão sobre despesa já decidida ⇒ `CONFLICT`.

### UC-SEG-13 Corrigir despesa devolvida
- **Ator:** clínica · **BR:** BR-SEG-12 · **Fluxo:** edita linhas/anexos de uma despesa `RETURNED` → volta a `SUBMITTED`.
- **Alternativos:** editar despesa noutro estado ⇒ `INVALID_STATE_TRANSITION`.

### UC-SEG-14 Consultar saldo de cobertura
- **Ator:** paciente (`SELF`/`TUTOR_OF`, com ligação confirmada), `BENEFICIARY_MANAGER`/`INSURANCE_ADMIN` (leitura) · **BR:** BR-SEG-07/08/20 · **Fluxo:** por cobertura, limite, usado, reservado e saldo (limite − usado − reservado; menor entre individual/família/ano), na moeda da seguradora (ex.: 500.000 − 120.000 = 380.000 Kz).
- **Alternativos:** sem ligação ⇒ só cartão manual (ADR-021) — `NOT_FOUND`; várias seguradoras: uma consulta por cartão (BR-SEG-23).

### UC-SEG-15 Ver cartão digital
- **Ator:** paciente com ligação confirmada · **BR:** BR-SEG-18/20 · **Fluxo:** cartão (nome, nº, plano, validade) e QR com token assinado, rotativo e revogável (`cardVersion`); também a reclamação do cartão (nº de apólice + código, Q2) e o histórico de autorizações/despesas com valores comparticipados.
- **Alternativos:** beneficiário não `ACTIVE` ⇒ cartão indica o estado; token expirado ⇒ novo token.

### UC-SEG-16 Dashboard
- **Ator:** conforme `authorization.md` §8.2b (completo: `INSURANCE_ADMIN`, `FINANCE_MANAGER`; parcial: restantes) · **Fluxo:** indicadores calculados no servidor, filtrados por `insurerId` e papel: beneficiários ativos, apólices ativas/expiradas, beneficiários por empresa, autorizações pendentes e tempo médio de decisão, total de despesas, despesas por prestador/plano, autorizado vs. faturado, despesas rejeitadas, taxa de utilização dos planos.
- **Alternativos:** sem dados nominais de saúde; período por omissão 12 meses.

### UC-SEG-17 Consultar histórico/auditoria
- **Ator:** `INSURANCE_ADMIN` (auditoria da seguradora); paciente (o seu próprio histórico, UC-SEG-15) · **BR:** BR-SEG-14/15 · **Fluxo:** lista paginada de eventos da seguradora (decisões, alterações de apólice/plano/cobertura, validações de elegibilidade, permissões) filtrada por `insurerId`.
- **Alternativos:** outros papéis ⇒ `FORBIDDEN`; a leitura de auditoria global continua sem endpoint (`audit.md` §2 regra 4) — esta é uma vista restrita à seguradora (**pendência**: confirmar que não contradiz P7).

### UC-SEG-18 Classificar serviços por tipo (`service_kind`) — marco B fatia 2
- **Ator:** `INSURANCE_ADMIN` (leitura: qualquer papel do módulo) · **BR:** BR-SEG-22/39 · **Fluxo:** vê os tipos da seguradora (`GET /service-kinds`, 9 por omissão) → cria/edita tipos se precisar → atribui o tipo aos serviços: um a um (`PATCH` do serviço, 1 campo) ou **uma categoria de cada vez** (`POST /services/classify`, 1 passo por categoria). Serviços sem tipo ficam «por classificar» e a lista di-lo.
- **Alternativos:** tipo inexistente/de outra seguradora/inativo ⇒ `VALIDATION_ERROR`; `code` repetido ⇒ `CONFLICT`; inativar tipo com serviços `ACTIVE` ⇒ `CONFLICT`. O utilizador da clínica nunca escolhe o tipo de guia: vê-o deduzido do serviço (fatia 3).

### UC-SEG-19 Configurar a política da seguradora (prazos) — marco B fatia 2
- **Ator:** `INSURANCE_ADMIN` e `SUPERVISOR` (desde a fatia 4; leitura: qualquer papel do módulo) · **BR:** BR-SEG-40 · **Fluxo:** lista as regras (`GET /policy-settings`: mínimo/máximo do Vita, omissão, valor efetivo) → edita **1 valor por regra** (`PUT /policy-settings/{key}`) → opcionalmente define exceção por serviço (só `AUTHORIZATION_DECISION_HOURS`) → «repor» apaga a definição e volta ao valor acima.
- **Alternativos:** fora de `min..max` ⇒ `VALIDATION_ERROR` com a mensagem do intervalo; `serviceId` numa chave que não o admite ⇒ `VALIDATION_ERROR`; serviço de outra seguradora ⇒ `NOT_FOUND`.

### UC-SEG-20 Fila de autorizações e atribuição — marco B fatia 4
- **Ator:** leitura: `AUTHORIZATION_ANALYST`, `SUPERVISOR`, `INSURANCE_ADMIN`, `CLAIMS_MANAGER`, `FINANCE_MANAGER`; atribuir: analista (toma um pedido livre) e `SUPERVISOR` (atribui/liberta) · **BR:** BR-AUT-18/19/20 · **Fluxo (1 passo por pedido):** abre a fila (por omissão: abertos, o mais atrasado primeiro; filtros «meus», «sem analista», «em atraso», «escalados», «recursos», «decididos pelo sistema») → toma o pedido (ou o supervisor atribui a um analista da lista) → decide (UC-SEG-07).
- **Alternativos:** pedido já atribuído a outro ⇒ `409`; recursos não se atribuem (o supervisor decide-os); analista removido ⇒ os seus pedidos voltam à fila livre. O supervisor vê a marca de escalada e as métricas (UC-SEG-22).

### UC-SEG-21 Gerir as regras de auto-aprovação — marco B fatia 4
- **Ator:** `SUPERVISOR` (leitura: analista e `INSURANCE_ADMIN`) · **BR:** BR-AUT-03/23, BR-SEG-03 · **Fluxo (1 passo por regra):** escolhe o alvo (um tipo de serviço **ou** um serviço), o valor máximo e o nome → ativa/desativa/apaga; o rasto de cada pedido mostra que regra (se alguma) o aprovou.
- **Alternativos:** regra ativa já existente no mesmo alvo ⇒ `409`; alvo inativo/de outra seguradora ⇒ `422`/`404`; mais de 100 ⇒ `LIMIT_EXCEEDED`. Alterar não afeta pedidos já avaliados. Sem regras ativas não há auto-aprovação. Carência e limite esgotado **nunca** são auto-aprovados, por mais regras que existam.

### UC-SEG-22 Acompanhar o SLA — marco B fatia 4
- **Ator:** os mesmos papéis de leitura da fila · **BR:** BR-AUT-20, BR-SEG-40 · **Fluxo:** consulta as métricas (abertos, em atraso, escalados; no período: decididos, % no prazo, % automáticos, mediana de horas) → no pedido escalado o `SUPERVISOR` reatribui ou, se for recurso, decide; o prazo configura-se em UC-SEG-19.
- **Alternativos:** período superior a 366 dias ⇒ `422`. O atraso **só marca**; nunca decide.

> **Fatia 5 (ADR-036):** as transições de UC-SEG-06/07/20 (auto-aprovação, aprovar, recusar, pedir informação, reverter) passam a chamar, **na mesma transação**, a porta `FamilyNotifier` (UC-ALR-07, BR-ALR-10); a clínica **não** recebe notificação nova e a família só vê o estado no `Process` (BR-PRC-12). Nenhum fluxo do analista ou do prestador muda.
