# Módulo de Seguradoras — Conflitos com a documentação e decisões em aberto

> Estado: 2026-11-05 — **Q1–Q3, Q5–Q13 decididas pelo proprietário (secção E) e formalizadas no ADR-025 (D21); Q4 continua por decidir** (assumida a seguradora do cartão apresentado). Complementa `01-functional-spec.md`. Os conflitos C1–C7 estão resolvidos no ADR-025.

## A. Conflitos com decisões já aprovadas (exigem ADR-024 explícito)

| # | Documento aprovado | Conflito | Proposta |
|---|---|---|---|
| C1 | ADR-021 / BR-INS-08 | Exclui "pré-autorização", "verificação automática da apólice" e "consulta de cobertura". O módulo novo faz as três. | ADR-024 substitui BR-INS-08 para seguradoras com módulo operacional ativo; mantém-no para o fluxo de reembolso. |
| C2 | ADR-021 (mínimo necessário, BR-CLN-03) | A seguradora vê só o pedido de reembolso e os documentos escolhidos pelo titular. A seguradora do módulo novo guarda dados próprios de beneficiários (dados que ela já detém como contratante). | Separar: dados **da seguradora** (`Beneficiary`, `Policy`…) vs. dados **de saúde do paciente** (`FamilyMember`, ADR-005). Nunca se cruzam, exceto por vinculação com consentimento. |
| C3 | ADR-020 / BR-CLN-03 | A clínica só vê o necessário. Validar beneficiário e submeter despesas dá-lhe acesso a dados de seguro de terceiros e vice-versa. | Resposta de elegibilidade mínima (§6 do spec); relação explícita `Provider` ↔ `Clinic`; auditoria de cada validação. |
| C4 | `authorization.md` §8 | Só dois papéis de seguradora (`ADMIN`/`AGENT`) com permissões iguais. O proprietário pede cinco. | Alargar §8 com a matriz do spec §2; manter `INSURANCE_AGENT` para reembolsos. |
| C5 | `scope.md` §1/§3, ADR-022 | Fase 3 inclui IA/deteção de fraude/previsão. | Fora do MVP; sujeito ao gate de ADR-022 (AIPD + DPA). |
| C6 | `schema.md` (`currency default 'EUR'`), `infrastructure.md` (UE) | O proprietário usa Kz (AOA) e o seu mercado parece ser Angola. | Q1. |
| C7 | `entities.md`: tudo pertence a `FamilyMember` | `Beneficiary` é um conceito novo, centrado na seguradora. | Ver C2; novo ADR de modelo. |

## B. Decisões em aberto para o proprietário

- **Q1 — Mercado, moeda e RGPD/lei local.** Kz (AOA) como moeda por seguradora? A Lei angolana de proteção de dados (Lei 22/11) aplica-se além do RGPD? Isto afeta AIPD, textos legais e alojamento (a VPS e backups devem estar na UE — pendência existente).
- **Q2 — Ligação paciente ↔ beneficiário.** Recomendado: o paciente reclama o cartão com nº de apólice + código; a seguradora confirma. Alternativa: a seguradora convida por e-mail. Sem ligação, só o cartão manual do ADR-021.
- **Q3 — Dois fluxos de dinheiro.** Faturação direta (clínica → seguradora) e reembolso (paciente → seguradora) coexistem? Como evitar o duplo pagamento do mesmo ato?
- **Q4 — Que seguradora valida?** Uma clínica pode ligar-se a várias seguradoras; como escolhe a seguradora do paciente (pelo cartão, único caso aceite no MVP)?
- **Q5 — Diagnóstico no atendimento.** Campo existe só "se necessário e autorizado". Quem autoriza, e a clínica envia-o à seguradora? Recomendação MVP: **sem diagnóstico**, só código de serviço.
- **Q6 — Papel "Médico".** O ADR-020 só tem `CLINIC_ADMIN`/`CLINIC_MANAGER`. Acrescentar `CLINIC_DOCTOR` (registar atendimentos e pedir autorizações) ou ficar com o gestor?
- **Q7 — Catálogo de serviços.** Quem mantém os códigos de serviço (nomenclatura nacional/seguradora/VitaFamily)? Sem isto, coberturas e preços não são comparáveis entre seguradoras.
- **Q8 — Arredondamento e regras de limite.** Arredondamento (por linha ou total), ordem copagamento→limite, e se o limite familiar prevalece sobre o individual (spec BR-SEG-08 assume o mais restritivo).
- **Q9 — Autorização automática.** Confirmar que existe auto-aprovação e o teto configurável por plano, ou se todas as autorizações têm de ser humanas no MVP.
- **Q10 — Pagamentos.** Marcar `PAID` pela seguradora (fase 2) ou só até `APPROVED` no MVP (proposta)?
- **Q11 — Multi-seguradora por utilizador.** Um paciente pode ter beneficiário em duas seguradoras (ex.: individual + empresa)?
- **Q12 — Importação.** Formato de CSV/Excel de referência e tamanho máximo do lote.
- **Q13 — Isolamento.** Basta FK composta + testes, ou o proprietário quer RLS PostgreSQL por `insurer_id`? (RLS é mais robusto mas complica pg-boss/migrações.)

## C. Riscos

- **Segurança/privacidade:** enumeração de beneficiários pela clínica (mitigar: rate limit, resposta mínima, auditoria, QR rotativo); fuga entre seguradoras (testes de isolamento obrigatórios); dados de saúde de terceiros → AIPD.
- **Escopo:** 7 capacidades são várias vezes o âmbito do ADR-021; entregar por marcos S1–S6 e rever em cada um.
- **Regras monetárias:** erros de arredondamento/limites afetam dinheiro real; exigir testes de propriedade e casos do exemplo do proprietário (20.000 Kz × 80 %; 500.000 − 120.000).

## D. Passos para aprovar e implementar

1. Proprietário responde às Q1–Q13 (ou aceita as recomendações).
2. `vita-architect` redige ADR-024 e propaga: `business-rules.md` (`BR-SEG-*`), `entities.md`, `state-machines.md`, `authorization.md`, `schema.md` (migração), `openapi.yaml`/`endpoints.md`, `03-use-cases/`, `audit.md` (catálogo, incluindo a pendência existente de ADR-021), `plan.md` (S1–S6).
3. Só depois, implementação pelos agentes `vita-identity`/`vita-family`/`vita-health` conforme o módulo, com revisão final de `vita-qa-security`.

## E. Decisões do proprietário (2026-11-05, em conversa) — a formalizar no ADR-024 (formalizadas no ADR-025)

| Q | Decisão | Efeito no spec |
|---|---|---|
| Q1 | Angola, **Kz (AOA) por seguradora** | Moeda configurável por seguradora; schema deixa de assumir EUR; confirmar lei angolana de proteção de dados (AIPD, textos legais) |
| Q2 | O paciente **reclama o cartão** (nº apólice + código da seguradora, confirmação da seguradora) | Spec §7 como proposto |
| Q3 | **Bloquear reembolso** quando a despesa da clínica foi aprovada | Atendimento marcado `DIRECT_BILLED` |
| Q5 | **Sem diagnóstico**, só código de serviço | `Encounter.diagnosis` removido do MVP |
| Q6 | **Sem novo papel de médico**; o `CLINIC_MANAGER` faz tudo | Spec §2: remover a nota "Médico por decidir" |
| Q7 | **Lista de serviços por seguradora** (sem catálogo comum) | `serviceCode` é por seguradora; a clínica vê a lista da seguradora do cartão; sem comparação entre seguradoras |
| Q8 | **O menor saldo** entre individual, familiar e anual | BR-SEG-08 confirmada |
| Q9 | **Auto-aprovação com teto por plano**; alto custo sempre humano | BR-SEG-03 confirmada |
| Q10 | MVP termina em **`APPROVED`**; `PAID` na fase 2 | Spec §4.2 confirmado |
| Q11 | Várias seguradoras por paciente, **escolhe-se pelo cartão** | Sem coordenação de benefícios |
| Q12 | Importação **até 5.000 linhas, CSV e XLSX** | BR-SEG-17 |
| Q13 | **FK composta + testes**, sem RLS | Spec §3 confirmado |
| Q4 | **Decidida em 2026-11-11 (ver nota abaixo):** a seguradora que valida é a do **cartão apresentado** | Sem pesquisa transversal nem desempate; `GET /clinic-portal/insurers` + `insurerId` no caminho; QR/nº de cartão de outra seguradora ⇒ resposta genérica `eligible:false` |

> **Nota datada 2026-11-11 — Q4 fechada (decisão do proprietário, Fase A).** A seguradora que valida é a **do cartão apresentado**: o nº de cartão/QR identifica o `insurerId`; a clínica escolhe-a na lista `GET /clinic-portal/insurers` (só as ligadas por `insurer_providers`). Sem regra de desempate nem pesquisa entre seguradoras; o paciente com várias seguradoras tem um cartão por seguradora (Q11). **Decisão conjunta D-A2:** a Fase A mostra ao paciente **só cobertura e limites**, **sem «usado»/saldo consumido** (sem `CoverageConsumption`, sem reservas); o saldo real chega com S4/S5. O estado «Q4 por decidir» das secções acima e da tabela E é histórico. Contrato: `05-api/openapi.yaml` (Fase A), `11-implementation/insurer-phase-a.md`.
