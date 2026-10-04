# Vita Family — instruções do projeto

Monorepo: `apps/api` (Go, monólito modular em camadas, ADR-013), `apps/web` (futuro), `deploy/`, `docs/`. Backend em **Go**, VPS própria, `https://vitafamily.cassfrei.com` (API em `/api/v1`), responsável: **Cassfrei**.
**A documentação em `docs/` é a fonte única da verdade** (ver `docs/README.md`). Se código e docs divergirem: parar, reportar, decidir, atualizar docs, corrigir código. Não inventar funcionalidades; alterações por change control (decisão do proprietário).

Leitura mínima (economizar tokens): este ficheiro + `docs/11-implementation/conventions.md` + os docs do teu módulo:
- Contrato: `docs/05-api/openapi.yaml` (+ `endpoints.md`, `errors.md`)
- Dados: `docs/07-database/schema.md`, `docs/04-domain/entities.md`, `state-machines.md`
- Regras: `docs/01-requirements/business-rules.md`, casos de uso em `docs/03-use-cases/<area>.md`
- Permissões: `docs/08-security/authorization.md`
- Plano e milestones: `docs/11-implementation/plan.md`

Código da API em `apps/api/internal/modules/<m>/{<m>.go, internal/{domain,service,repo,handler}}` (ver conventions.md §1); comandos na raiz: `make gen|test|lint|build`. Go não está instalado no host (tudo corre em Docker).

Agentes (`.claude/agents/`): `vita-architect` (guardião da doc/ADR), `vita-platform` (M0), `vita-identity` (M1), `vita-family` (M2–M3), `vita-health` (M4, M6, M7), `vita-documents` (M5), `vita-alerts` (M8), `vita-lifecycle` (M9), `vita-qa-security` (testes e segurança), `vita-devops` (Docker, Caddy, VPS, backups).
