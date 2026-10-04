# Casos de uso — Exames e documentos (Fase 6)

> Estado: **RASCUNHO v0.1** — convenções comuns em `family.md`.
> Quem pode: titular ou tutor (categoria C6). Dependente com conta **não** vê exames (N2). Membros com C6 partilhado veem.
> O sistema **não interpreta** resultados (FR-EXM-05, D11).

### UC-EXM-01 Registar exame
- **Ator:** titular ou tutor · **FR:** EXM-01, EXM-06
- **Fluxo:** escolhe o membro → indica nome/tipo, data (passada = realizado, futura = agendado), local (clínica opcional), observações → sistema cria o exame → se futuro, gera lembretes (UC-ALR-01).
- **Estados simples:** `[proposta Fase 10]` AGENDADO, REALIZADO, CANCELADO.

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
