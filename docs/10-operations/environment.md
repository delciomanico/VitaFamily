# Vita Family — Ambientes e configuração (Fase 16)

> **ATUALIZAÇÃO 2026-10-08 (ADR-014/ADR-015, decisão do proprietário):** a implementação é em **Node.js/TypeScript** (Clean Architecture), Kysely+`pg` e runner de migrações próprio (sem Prisma), pg-boss, **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz NestJS, Prisma, Redis, BullMQ ou Jest, ler o equivalente de ADR-014/ADR-015.

> Estado: **v0.1**. Valores concretos de fornecedor/domínio ficam por decidir **operacionalmente** no M0/M10 (não alteram a especificação).

## 1. Ambientes
| Ambiente | Finalidade | Dados | Serviços |
|---|---|---|---|
| **local** | Desenvolvimento | sintéticos (seed) | Docker Compose: postgres, minio, clamav, mailhog; `api`/`worker` em Node no host |
| **test** (CI) | Testes automáticos | sintéticos, efémeros | testcontainers / Compose |
| **staging** | Validação pré-release, ensaio de migrações e restauros | **sintéticos**, nunca reais | réplica de produção, sem dados reais |
| **production** | Utilizadores reais | reais | UE; ver `infrastructure.md` |

Regra: **dados reais só em produção** (NFR-OPS-04). Ferramentas de suporte/depuração nunca copiam produção.

## 2. Configuração por variáveis de ambiente
(Nomes; valores nunca no repositório. Validadas no arranque: falha rápida se faltar algo.)

| Grupo | Variáveis |
|---|---|
| Aplicação | `NODE_ENV`, `PORT`, `APP_BASE_URL`, `PWA_ORIGIN` (CORS), `LOG_LEVEL`, `TERMS_VERSION` |
| Base de dados | `DATABASE_URL` (papel da app), `DATABASE_MAINTENANCE_URL` (papel de manutenção: anonimização/purga de auditoria) |
| Armazenamento | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET_DOCUMENTS`, `S3_BUCKET_EXPORTS`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| Antivírus | `CLAMAV_HOST`, `CLAMAV_PORT` |
| Autenticação | `JWT_SIGNING_KEYS` (lista com `kid`), `JWT_ACCESS_TTL=15m`, `REFRESH_TTL=30d`, `COOKIE_DOMAIN` |
| E-mail | `SMTP_URL`, `MAIL_FROM` |
| Web Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Limites | `UPLOAD_MAX_BYTES=10485760`, `FAMILY_STORAGE_QUOTA_BYTES=104857600` |
| Observabilidade | `METRICS_ENABLED`, `SENTRY_DSN` (opcional; com redação de dados) |

## 3. Segredos
- Gerados por ambiente, distintos entre ambientes, rotação documentada (chave JWT com `kid`, VAPID, S3, SMTP).
- Injetados pelo orquestrador/gestor de segredos; `.env` só em local e fora do Git (`.env.example` sem valores reais).
- Acesso a segredos de produção: mínimo de pessoas, auditado.

## 4. Bootstrap
- Migrações: `pnpm migrate` (runner próprio aplica `db/migrations/*.sql` numa transação, com tabela de controlo).
- Primeiro **Platform Admin**: comando CLI explícito e auditado (`create-platform-admin <email>`); sem conta admin por defeito.
- Clínicas parceiras: criadas pelo Platform Admin pela API.
- Cópia de dados de produção para outros ambientes: **proibida**.
