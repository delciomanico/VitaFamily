# Casos de uso — Assistente de IA ligado pelo utilizador (M18, ADR-039, change control 2026-11-21)

> Estado: **PROPOSTA v0.1** (decisão do proprietário de 2026-11-21; contrato a ratificar, OP-132..143). Regras: `BR-AI-01..16` (`business-rules.md` §19); arquitetura e alternativas em `ADR-039`. **A chamada ao fornecedor é feita do dispositivo**; a Vita só autoriza, verifica o consentimento, monta o contexto minimizado, aplica limites e audita (sem dados de saúde). **Gate de lançamento: AIPD + parecer jurídico (BR-AI-14); funcionalidade atrás de `AI_ASSISTANT_ENABLED` (omissão `false`).**
> Quem pode: `SELF` adulto; `TUTOR_OF` pelo dependente. **Não:** `DEPENDENT_SELF`, `OTHER` (BR-AI-04).

### UC-AI-01 Ligar um fornecedor de IA e consentir
- **Ator:** `SELF` ou `TUTOR_OF` · **FR:** AI-01 · **BR:** BR-AI-01..04, BR-AI-16
- **Fluxo:** Definições › Assistente › escolhe o **membro** (próprio ou dependente) e o **fornecedor** → lê o texto de consentimento, que **nomeia o fornecedor** e diz que os dados **saem da Vita Family** (BR-AI-03) → marca a caixa e confirma → (i) **Gemini:** «Continuar com Google» (consentimento OAuth Google no âmbito de Generative Language; token só em memória, renovável por novo pedido); (ii) **Claude/GPT:** cola a **chave de API da sua conta**; a app guarda-a cifrada **só no dispositivo** (BR-AI-02) e testa-a com um pedido mínimo sem dados de saúde → `PUT /families/{f}/members/{m}/ai/consents/{provider}` regista o consentimento.
- **Alternativos:** `DEPENDENT_SELF`/`OTHER` ⇒ `FORBIDDEN`; fornecedor indisponível por CORS/chave inválida ⇒ erro simples e **nenhum consentimento é registado** (o consentimento só se grava depois do teste); utilizador cancela o OAuth ⇒ nada acontece.
- **Pós-condição:** `ai_consents` ativo (utilizador, membro, fornecedor, versão do texto); auditoria `AI_CONSENT_GRANT`.

### UC-AI-02 Pedir um resumo inteligente (insights com IA)
- **Ator:** `SELF` ou `TUTOR_OF` · **FR:** AI-02 · **BR:** BR-AI-05..06/08..10/15
- **Fluxo:** no Resumo de saúde (UC-RPT-05) → «Explicar com IA» → escolhe o fornecedor (com consentimento ativo) → `POST …/ai/sessions` (`kind=SUMMARY`, `from`, `to`) devolve `sessionToken` e o **contexto minimizado** (séries com datas relativas, adesão com etiquetas «Medicamento A/B», sem nomes) → o dispositivo chama o fornecedor, valida o esquema e aplica o filtro (BR-AI-09) → mostra o resumo em linguagem simples **ao lado dos números em bruto** com o **aviso permanente** → `POST …/ai/sessions/{id}/outcome`.
- **Alternativos:** sem consentimento ⇒ `AI_CONSENT_REQUIRED` (UI leva a UC-AI-01); resposta bloqueada pelo filtro ⇒ mensagem neutra (o Resumo sem IA continua visível); fornecedor em erro/quota ⇒ «Não foi possível obter a explicação» (sem repetição automática); `429 RATE_LIMITED`; `AI_ASSISTANT_ENABLED=false` ⇒ a opção não existe.

### UC-AI-03 Análise de sintomas leve
- **Ator:** `SELF` ou `TUTOR_OF` · **FR:** AI-02 · **BR:** BR-AI-05..11
- **Fluxo:** Assistente › «Tenho sintomas» → aviso inicial + escolhe membro/fornecedor → escreve os sintomas (texto livre, **avisado de que sai da Vita Family para o fornecedor**) → opcional «incluir contexto» (sexo declarado, condições ativas; desligado; **indisponível para menores**) → **deteção local de sinais de alarme** (BR-AI-07) → se limpo, `POST …/ai/sessions` (`kind=SYMPTOMS`, `includeContext`) devolve o contexto (faixa etária e, se pedido, contexto) → o dispositivo envia **sintomas + contexto** ao fornecedor com o *prompt* de sistema dos *guardrails* → valida/filtra → mostra **orientação geral**, sinais a vigiar e, se aplicável, «os sintomas **podem justificar uma consulta de <especialidade>**» com botão **«Ver profissionais»** (UC-MKT-13 com `specialtyId` do catálogo; sem dados no URL) → aviso permanente.
- **Alternativo — sinais de alarme (BR-AI-07):** texto com dor no peito, falta de ar, sinais de AVC, hemorragia, ideação suicida, etc. ⇒ **mensagem fixa de urgência imediata**, **sem** análise e **sem** chamada ao fornecedor; a mesma mensagem substitui qualquer resposta do modelo que sinalize urgência; desfecho `ALARM` reportado em melhor esforço (sem texto).
- **Proibido:** diagnóstico, medicamentos/doses/tratamento, «normal/perigoso» (BR-AI-06). Resposta que o filtro apanhe ⇒ bloqueada por inteiro.

### UC-AI-04 Desligar o assistente
- **Ator:** quem consentiu · **BR:** BR-AI-16
- **Fluxo:** Definições › Assistente › «Desligar» → apaga a chave do dispositivo (ou revoga o token Google) e `DELETE /families/{f}/members/{m}/ai/consents/{provider}`; auditoria `AI_CONSENT_REVOKE`.
- **Alternativos:** falha de rede ao revogar ⇒ a chave local apaga-se na mesma e o pedido de revogação fica por repetir (a sessão seguinte exigiria consentimento e chave de qualquer forma); eliminar membro/conta apaga os consentimentos (cascata).

### UC-AI-05 Obter os *guardrails* (técnico)
- `GET /ai/guardrails` (utilizador autenticado, resposta versionada com `ETag`): *prompt* de sistema, lista de bloqueio, lista de sinais de alarme, lista de especialidades permitidas e mensagem fixa de urgência. A app guarda-os em cache; **sem *guardrails* carregados nenhuma análise se executa** (falha fechada, BR-AI-09).

> Critérios: `AC-AI-01..12`; testes: `TC-AI-01..24`, `TC-AZ-AI-01..04`.
