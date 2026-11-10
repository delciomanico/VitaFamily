# Casos de uso — Exames e documentos (Fase 6)

> Estado: **RASCUNHO v0.1** — convenções comuns em `family.md`.
> Quem pode: titular ou tutor (categoria C6). Dependente com conta **não** vê exames (N2). Membros com C6 partilhado veem.
> O sistema **não interpreta** resultados (FR-EXM-05, D11).

### UC-EXM-01 Registar exame
- **Ator:** titular ou tutor · **FR:** EXM-01, EXM-06
- **Fluxo:** escolhe o membro → indica nome/tipo, data (passada = realizado, futura = agendado), local (clínica opcional), observações → sistema cria o exame → se futuro, gera lembretes (UC-ALR-01).
- **Estados simples:** `[proposta Fase 10]` AGENDADO, REALIZADO, CANCELADO.
> D19/ADR-023 (revisto 2026-11-04): numa clínica **parceira**, usar UC-EXM-08 (marcação direta num horário com vagas; nasce AGENDADO).

### UC-EXM-02 Adicionar resultados estruturados
- **Ator:** titular ou tutor · **FR:** EXM-03
- **Fluxo:** adiciona linhas: parâmetro, valor, unidade, intervalo de referência (**opcional, informado pelo utilizador**).
- **Regras:** o sistema guarda e mostra; **não** assinala valores fora do intervalo nem gera alertas (D11-A); o valor é numérico ou texto `[ver Q9]`.

### UC-EXM-03 Anexar documento ao exame
- **Ator:** titular ou tutor · **FR:** EXM-02, DOC-01, DOC-02
- **Fluxo:** ver UC-DOC-01.

### UC-EXM-04 Ver exames e resultados
- **Ator:** titular, tutor, membro com C6 partilhado · **FR:** EXM-04
- **Resultado:** lista por membro/período/estado; detalhe com resultados e documentos; **histórico de um parâmetro ao longo do tempo** (lista de valores por data, sem gráficos nem interpretação no backend) `[PROPOSTO]`.

### UC-EXM-05 Editar exame ou resultados
- **Ator:** titular ou tutor · **Regra:** só estado atual (R6); alteração auditada.

### UC-EXM-06 Marcar exame como realizado / cancelar
- **Ator:** titular ou tutor.

### UC-EXM-07 Eliminar exame
- **Ator:** titular ou tutor · **FR:** DOC-04 · **Efeito:** apaga resultados, documentos e lembretes.

### UC-EXM-08 Marcar exame num horário de clínica parceira (D19, revisto 2026-11-04)
- **Ator:** titular ou tutor · **FR:** EXM-07 · **BR:** BR-CLN-07, BR-EXM-05, BR-APT-11
- **Fluxo:** escolhe o membro → clínica parceira → horário **de exame** com vagas (`kind=EXAM`, tipo de exame, dia, hora e vagas restantes) → observações opcionais → é informado de que a clínica recebe nome, tipo de exame, data/hora e observações → confirma → exame **AGENDADO** (`SCHEDULED`) de imediato, com tipo/data/clínica congelados do horário, e uma vaga ocupada.
- **Alternativos:** horário cheio ou entretanto removido/passado → `CONFLICT`; horário de consulta → `VALIDATION_ERROR` (BR-APT-10); membro já com marcação ativa nesse horário → `CONFLICT`; cancelar → `CANCELLED` e a vaga liberta-se.
- **Pós-condição:** lembrete 24 h gerado (BR-EXM-06); sem passo de confirmação nem expiração. Só `notes` editáveis; mudar data/hora = cancelar e marcar outro horário (BR-EXM-08). Concorrência: a reserva é serializada por bloqueio do horário (BR-APT-11).
- **M15 U (ADR-028, UC-CLN-42):** `ExaminationInput.examOrderId` (opcional, em qualquer registo/marcação de exame do membro) liga o exame a um pedido de exame `ORDERED` do mesmo membro (titular/tutor); `NOT_FOUND` se não visível, `CONFLICT` se já não está `ORDERED`. O exame cancelado/apagado desliga o pedido (volta a `ORDERED`); concluído ⇒ pedido `FULFILLED` (BR-CLN-52).

### UC-EXM-09 Ver resultados e documentos emitidos pela clínica (D19)
- **Ator:** titular, tutor, membro com C6 partilhado · **Resultado:** exame `COMPLETED` com `issuedBy=CLINIC`, resultados estruturados e documentos (PDF) emitidos pela clínica; download mediado e auditado (UC-DOC-02). Documentos da clínica não aparecem antes de `COMPLETED` (BR-CLN-08).

---

## Portal da clínica — exames (D19, ADR-023)
> Mirror de UC-CLN-04..06. Minimização (BR-CLN-03): nome do paciente, tipo de exame, data/hora e observações do pedido.

### UC-CLN-07 Publicar horários de exame e gerir vagas
- **Ator:** conta da clínica · **FR:** CLN-02 · Igual a UC-CLN-04 com `kind=EXAM`; `specialty` = tipo de exame; define `capacity` (1–50, default 1). Pode alterar `capacity` (nunca abaixo das marcações ativas → `CONFLICT`) e só remove horários sem marcações ativas (BR-CLN-04, BR-APT-11).

### UC-CLN-08 Ver a ocupação dos horários de exame
- **Ator:** conta da clínica · **FR:** EXM-07 · **Fluxo:** lista os seus horários `kind=EXAM` com `capacity`, `bookedCount`, `remaining` e estado (FREE/PARTIAL/FULL). Não há pedidos por confirmar ou recusar: os exames nascem `SCHEDULED` por marcação direta da família (BR-CLN-07). *(Substitui o antigo "Confirmar ou recusar pedidos de exame", obsoleto.)*

### UC-CLN-09 Agenda de exames e cancelar
- **Ator:** conta da clínica · **Resultado:** marcações por dia (mínimo, BR-CLN-03); pode cancelar uma marcação `SCHEDULED` futura com motivo obrigatório (liberta a vaga; titular/tutor informado, `EXAM_CANCELLED`).

### UC-CLN-10 Completar exame com resultados e PDF
- **Ator:** conta da clínica · **FR:** EXM-08, EXM-09 · **BR:** BR-CLN-08
- **Fluxo:** (opcional) carrega 1–5 PDF no exame `SCHEDULED` (quarentena + antivírus; vê só estado de verificação; pode remover os seus) → completa com 0–50 parâmetros (parâmetro, valor numérico e/ou texto, unidade, intervalo de referência opcional **informado pela clínica**) e nota opcional → `COMPLETED`, `issuedBy=CLINIC` → o paciente é notificado (`EXAM_RESULTS_AVAILABLE`).
- **Regras:** pelo menos um resultado ou um PDF; sem interpretação nem alertas por valor (D11); só exame `SCHEDULED` da própria clínica (senão `CONFLICT`/`NOT_FOUND`); PDF infetado é eliminado e auditado (UC-DOC-01). **M15 T (ADR-027):** os resultados podem ser guardados antes como rascunho (UC-CLN-37) e, ao concluir, o sistema gera o laudo em PDF (UC-CLN-38, BR-CLN-47..49) — o realce "Fora da referência" é aritmético e só existe nesse PDF (emenda a BR-EXM-02).

---

## Documentos

### UC-DOC-01 Carregar documento
- **Ator:** titular ou tutor, no recurso a que se associa (receita C4, exame C6) · **FR:** DOC-01, DOC-02, N4
- **Fluxo:** envia ficheiro → sistema valida tipo real e tamanho (PDF/JPG/PNG, ≤10 MB) → guarda no armazenamento de objetos, regista metadados e checksum → análise antivírus → só depois fica **disponível**.
- **Alternativos:** tipo/tamanho inválido → recusado; **antivírus positivo** → ficheiro eliminado, upload recusado e auditado; análise pendente → estado "em verificação".
- **Regra:** limites por recurso (nº de ficheiros) 5 ficheiros por recurso e 100 MB por família (Q10)..

### UC-DOC-02 Descarregar / ver documento
- **Ator:** quem pode ver a categoria do recurso · **FR:** DOC-03
- **Fluxo:** pede o documento → sistema autoriza e entrega por acesso temporário → **auditado**.
- **Regra:** nunca URL pública permanente.

### UC-DOC-03 Substituir ou remover documento
- **Ator:** titular ou tutor · **Efeito:** remoção definitiva do ficheiro no armazenamento (NFR-DATA-05).
