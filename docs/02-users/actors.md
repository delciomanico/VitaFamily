# Vita Family — Atores (Fase 5)

> Estado: **RASCUNHO v0.1** — aprovação em conjunto com `roles.md` e `permissions.md`.
> Base: D1–D4, D13, D14, M1, M4, M6, N1–N3, R4, R8, R10.

## 1. Atores humanos

| Ator | Descrição | Tem conta? | MVP |
|---|---|---|---|
| **Visitante** | Pessoa não autenticada. Só pode registar-se, fazer login, recuperar conta e aceitar um convite. | Não | Sim |
| **User (adulto)** | Pessoa ≥18 anos com conta. Pode pertencer a várias famílias (D2). Controla os seus dados (D13). | Sim | Sim |
| **Dependente sem conta** | FamilyMember gerido pelos seus tutores. Não interage com o sistema. | Não | Sim |
| **Dependente com conta (acesso limitado)** | FamilyMember sob tutela com conta própria. Vê os seus medicamentos e consultas e confirma tomas (N2). | Sim | Sim |
| **Tutor / Responsável** | FamilyMember adulto responsável por um ou mais dependentes (relação por dependente, N1). Não é um papel da família. | Sim | Sim |
| **Platform Admin** | Staff Vita. Gere contas e clínicas parceiras; **sem acesso a dados de saúde** (D4, R10). | Sim (conta de plataforma) | Sim |
| **Gestor da clínica (Clinic Manager)** | Conta de uma clínica **parceira** (D17). Publica horários, confirma/recusa pedidos de consulta e vê a agenda da clínica — só dados mínimos da marcação, **nunca dados de saúde**. | Sim | Sim |

## 2. Atores do sistema

| Ator | Descrição |
|---|---|
| **Scheduler / Notifier** | Processo interno que gera ocorrências de toma e alertas e envia notificações por push e e-mail. Age em nome do sistema, nunca como utilizador. |

## 3. Atores fora do MVP

| Ator | Estado |
|---|---|
| **Clinic Admin** | Previsto pelo prompt (§9); fora do MVP. O **Clinic Manager** entrou com D17 (ver acima). |
| **Profissional de saúde** | Aparece só como texto numa consulta ou receita; não tem conta. |

## 4. Observação
"Dependente" cobre menores e adultos sob responsabilidade (N3); a tutela não depende da idade.
