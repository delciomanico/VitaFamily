# Casos de uso — Alertas e notificações (Fase 6)

> Estado: **v0.2 — Q1–Q11 decididas (delegadas)**
> Cadeia obrigatória: **Evento → Regra → Alerta → Notificação** (prompt §18). Cada passo tem responsabilidade própria.
> Texto das notificações: genérico, sem dados clínicos (N8); o detalhe só dentro da app.
> Nenhum alerta contém diagnóstico (FR-ALR-07).

## Cadeia (conceito)

```text
EVENTO              facto que ocorreu ou está para ocorrer
  (ex.: ocorrência de toma chega à hora; consulta a X horas)
     ↓
REGRA               decide se gera alerta e para quem
  (ex.: lembrete de toma ao titular e tutores; consulta 24 h e 2 h antes)
     ↓
ALERTA              registo persistente na app (lista, lido/não lido)
     ↓
NOTIFICAÇÃO         entrega por canal (push/e-mail) conforme preferências
```

### UC-ALR-01 Gerar alertas de agenda (processo do sistema)
- **Ator:** Scheduler · **FR:** ALR-01, ALR-02, ALR-04
- **Eventos MVP (D11-A):**

| Evento | Regra por defeito (R9) | Destinatários |
|---|---|---|
| Toma de medicamento no horário | no horário | titular; para dependente: tutores + o próprio se tiver conta (FR-ALR-08) |
| Consulta AGENDADA | 24 h e 2 h antes | idem |
| Exame AGENDADO | 24 h antes | idem |

- **Regras:** cada ocorrência gera **no máximo um** alerta por regra (idempotência, NFR-AVL-02); cancelar/editar o recurso cancela ou recalcula alertas futuros.
- **Pós-condição:** alerta criado; notificações pedidas para os canais ativos do destinatário.

### UC-ALR-02 Enviar notificação
- **Ator:** Scheduler/Notifier · **FR:** ALR-03; NFR-AVL-02/03, N8
- **Fluxo:** para cada destinatário e canal ativo (push, e-mail) → envia texto genérico → regista resultado.
- **Alternativos:** falha → repete com limite de tentativas e regista; falha de um canal não impede o outro; conta suspensa → não envia; sem canal ativo → o alerta existe na app, sem notificação externa.

### UC-ALR-03 Ver alertas
- **Ator:** User · **FR:** ALR-06
- **Resultado:** lista de alertas **dos quais é destinatário**, não lidos primeiro.

### UC-ALR-04 Marcar alerta como lido
- **Ator:** User (destinatário).

### UC-ALR-05 Configurar preferências de alertas
- **Ator:** User · **FR:** ALR-05, R9
- **Fluxo:** escolhe canais ativos e tipos (toma/consulta/exame), por conta.
- **Regra:** `[PROPOSTO]` desativar um tipo para um dependente aplica-se **ao destinatário**, não ao dependente; ver Q3 para alertas críticos.

### UC-ALR-06 Registar subscrição push
- **Ator:** User (cliente PWA) · **FR:** ALR-03, D12
- **Fluxo:** concede permissão de notificações no browser → o cliente regista a subscrição push no backend → o utilizador pode revogá-la.
- **Regra:** subscrições inválidas/expiradas são removidas.

---

## DECISÕES DESTA FASE (Q1–Q11)

> **Delegadas pelo proprietário ao assistente em 2026-10-04** ("adota a recomendação"). Adotada a recomendação em todas. Sujeitas a revisão por change control.

| ID | Decisão | Escolha | Consequência registada |
|---|---|---|---|
| Q1 | Frequência dos medicamentos | **B:** horários fixos diários (com dias da semana opcionais) **+** "de X em X horas" a partir de uma hora de início. "Se necessário" (SOS) fica fora do MVP. | UC-MED-01 |
| Q2 | Toma passa a "não confirmada" | **2 h** após o horário; confirmação tardia permitida até ao fim do dia seguinte. | UC-MED-05, UC-MED-09 |
| Q3 | Repetição do lembrete de toma | **Repete uma vez (15 min depois)** se não confirmado. Os alertas de toma podem ser desativados totalmente pelo utilizador. | UC-ALR-01, UC-ALR-05 |
| Q4 | Consulta passada sem atualização | **Fica AGENDADA** e o sistema envia lembrete a pedir confirmação do desfecho; nunca assume REALIZADA. | UC-APT-04, UC-RPT-02 |
| Q5 | Admin único com só dependentes | **Tem de nomear outro adulto com conta** (convidar) antes de sair. | UC-FAM-07 |
| Q6 | "Levar" dados ao sair | **Pacote JSON + documentos.** | UC-ACC-06, UC-MEM-09 |
| Q7 | Adultos sem ninguém a geri-los | **A:** perfil adulto sem conta só existe como dependente (com tutor); menor que faz 18 sem conta: dados bloqueados, Admin avisado, **apagados após 90 dias** sem conta; adulto com conta só passa a dependente com consentimento próprio. | UC-MEM-01, 07, 10 |
| Q8 | Fuso dos alertas de dependentes | Plano segue o fuso do **titular**; dependente sem conta usa o fuso do **tutor principal**; cada destinatário recebe no seu fuso. | UC-MED-01 |
| Q9 | Valores dos resultados | **Numérico opcional + texto livre.** | UC-EXM-02 |
| Q10 | Limites de ficheiros | **5 ficheiros por recurso; 100 MB por família.** | UC-DOC-01 |
| Q11 | Relatórios | Período por defeito **12 meses**, máximo **5 anos**; listas paginadas. | `reports.md` |

### Consequências a tratar na Fase 7
- **Tutor principal** (Q8) passa a ser um conceito: um dos tutores é marcado como principal.
- **Prazo de 90 dias** (Q7): regra de eliminação automática, com avisos.
- **Antecedência do aviso dos 18 anos** (P4): definir.

---

*Fim da Fase 6 (v0.2). Casos de uso fechados. Próxima: Fase 7 — Regras de negócio.*
