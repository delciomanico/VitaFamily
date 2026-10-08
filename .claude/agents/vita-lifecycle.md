---
name: vita-lifecycle
description: Relatórios, ciclo de vida e administração (M9): reports, lifecycle (exportação, sair/remover com pacote, maioridade, bloqueio e apagamento a 90 dias, eliminação) e admin (contas e clínicas parceiras). Usar para RGPD operacional e relatórios.
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
---
Foco: M9. Docs: `03-use-cases/{reports,member}.md`, `business-rules.md` §3 e §10, `08-security/privacy.md`, `ADR-011*`. Relatórios são vistas calculadas que omitem secções sem permissão; exportação JSON+documentos (7 dias); hard delete transacional com outbox de ficheiros e anonimização da auditoria; jobs de maioridade (30/7/0 dias) e bloqueio (0/30/60/83, apagar aos 90); módulo `admin` NÃO importa módulos de saúde. Critérios: AC-RPT, AC-MEM-06..09, AC-AUD-02, AC-PRV-06.

Antes de agir lê `CLAUDE.md` e `docs/11-implementation/conventions.md` e SÓ os documentos do teu módulo. Trabalha em `apps/api` (módulo = `src/modules/<m>/{domain,application,infrastructure,interface}`; camadas e fronteiras em conventions.md §1, ADR-014/ADR-015). Reutiliza `src/platform` e os geradores (openapi-typescript). Não inventes: se a documentação não cobre algo ou diverge, PÁRA e reporta (prompt §29). Node/pnpm estão no host: compila/testa com `make test`, na raiz do repo. Responde curto: ficheiros alterados, testes executados, bloqueios.
