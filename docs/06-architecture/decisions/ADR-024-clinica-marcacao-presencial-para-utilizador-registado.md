# ADR-024 — Portal da clínica: marcação presencial (walk-in) para um utilizador Vita já registado

**Estado:** Aceite — decisão **do proprietário** (2026-11-05, change control **D20**). Adenda a ADR-020/ADR-023; **emenda estreita** a BR-CLN-03. Não substitui nenhum ADR.

## Contexto
Um paciente apresenta-se na clínica sem ter marcado pela app. O Gestor/Admin da clínica quer marcar-lhe a consulta no momento. O portal (BR-CLN-03) nunca obtém ids nem identifica utilizadores; o paciente só chega à clínica por um pedido da família.

## Decisão
| Tema | Escolha |
|---|---|
| Fluxo | `CLINIC_ADMIN`/`CLINIC_MANAGER` (1) pesquisa um utilizador por **e-mail exato** e (2) marca uma consulta para ele num `ClinicSlot` `kind=APPOINTMENT`, **livre, futuro e publicado da própria clínica**. |
| Estado inicial | A consulta nasce **`SCHEDULED`** (paciente presente; sem passo `REQUESTED`), `slotId` preenchido (BR-APT-06), na agenda da clínica e na família do utilizador, no membro **SELF**. |
| Gestão | Só a clínica a gere pelos fluxos existentes (cancelar com motivo, completar com resultado/receita, recomendações). Sem fichas de paciente próprias da clínica. |
| Minimização (emenda a BR-CLN-03) | A clínica **nunca** recebe ids de utilizador/família/membro. A pesquisa devolve só `displayName` (primeiro nome + inicial do último apelido, ex. `Maria S.`) ou **404 genérico** — a mesma resposta para e-mail inexistente, utilizador não `ACTIVE` (pendente/suspenso) ou sem membro `SELF`. Só e-mail exato normalizado (minúsculas, trim), sem pesquisa parcial/prefixo. |
| Sem referências | A marcação **re-resolve o e-mail no servidor**; o contrato não expõe refs/tokens do paciente entre os dois passos (o cliente reenvia o e-mail). |
| Anti-enumeração | Rate limit forte por conta de clínica e por IP (BR-CLN-10); contador de falhas (404) à parte; auditoria de cada pesquisa. |
| Privacidade/consentimento | O utilizador está presente e entrega o seu e-mail à clínica; não há consentimento eletrónico adicional. A consulta fica visível ao utilizador (e ao tutor, se aplicável) como qualquer consulta de clínica parceira; o paciente é informado por alerta (`APPOINTMENT_CONFIRMED`) quando o mecanismo de alertas o suportar (OP-22). |
| Auditoria | `CLINIC_WALKIN_LOOKUP`, `CLINIC_WALKIN_BOOK` (`actor_type=CLINIC_ACCOUNT`; sujeito = membro; **nunca** o e-mail em claro em logs/`metadata`). |
| Dados | `appointments.walk_in boolean NN default false` (marca permanente) e `appointments.booked_by_clinic_account_id` (autor; `SET NULL` ao remover a conta; a marca `walk_in` mantém-se). Migração própria. |

## Consequências
- Novos: `POST /clinic-portal/patient-lookup` e `POST /clinic-portal/walk-in-appointments` (`openapi.yaml`, `endpoints.md`), BR-CLN-10, UC-CLN-08, AC-CLN-05/06, TC-CLN-03/TC-AZ-CLN-WALKIN, auditoria (`audit.md` §3), `authorization.md` §6.2, `schema.md` (appointments), plano M7d.
- A pesquisa por e-mail continua a ser um oráculo de existência de conta (confirma "este e-mail tem conta Vita ativa") a quem tem credenciais de clínica; mitigado por rate limit, auditoria, resposta mínima e conta de clínica autenticada. Risco residual aceite pelo proprietário e a cobrir na AIPD.
- **Fora do âmbito:** fichas de paciente da clínica, pesquisa parcial/por nome/telefone, marcação em nome de dependente sem conta, exames presenciais (só consultas), marcação sem horário publicado.
