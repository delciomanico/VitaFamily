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
- **Alternativos:** não elegível/inexistente ⇒ resposta genérica sem revelar o motivo além do necessário; excesso de tentativas ⇒ `429`/`RATE_LIMITED`; seguradora a que a clínica não está ligada ⇒ `NOT_FOUND`. O paciente consulta a sua própria elegibilidade em UC-SEG-14/15.

### UC-SEG-06 Pedir autorização
- **Ator:** clínica · **BR:** BR-SEG-02/03/04/05/07/16 · **Fluxo:** escolhe beneficiário validado, serviço, justificação, anexos, valor → `SUBMITTED` → o sistema aplica BR-SEG-03: `AUTO_APPROVED` (código, `validUntil`, reserva de saldo) ou `IN_REVIEW`.
- **Alternativos:** serviço `EXCLUDED` ⇒ recusado na validação; `Idempotency-Key` repetida devolve o mesmo pedido; alto custo nunca é automático.

### UC-SEG-07 Analisar e decidir autorização
- **Ator:** `AUTHORIZATION_ANALYST` · **BR:** BR-SEG-03/04/05/07/16 · **Fluxo:** abre pedido `IN_REVIEW` → aprova (define `authorizedAmount`, `validUntil`; reserva saldo; gera código), rejeita (motivo) ou pede informação (motivo) → notifica a clínica. Pode cancelar uma `AUTO_APPROVED`/`APPROVED` com motivo (reverte, liberta reserva).
- **Alternativos:** carência: pode sobrepor-se com motivo (BR-SEG-04); decisão sobre pedido já decidido ⇒ `CONFLICT`/`INVALID_STATE_TRANSITION`; saldo insuficiente ⇒ aprova só até ao saldo ou rejeita (decisão humana registada).

### UC-SEG-08 Responder a pedido de informação
- **Ator:** clínica · **Fluxo:** vê o pedido `INFO_REQUESTED` com o motivo → acrescenta justificação/anexos → `IN_REVIEW`.
- **Alternativos:** pedido noutro estado ⇒ `INVALID_STATE_TRANSITION`.

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
