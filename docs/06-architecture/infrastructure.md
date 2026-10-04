# Vita Family — Infraestrutura (Fase 11)

> **ATUALIZAÇÃO 2026-10-04 (ADR-012, decisão do proprietário):** a implementação é em **Go** (pgx+sqlc+goose, river, chi+oapi-codegen), **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz NestJS, Prisma, Redis, BullMQ ou Jest, ler o equivalente Go de ADR-012; a arquitetura lógica mantém-se.

> Estado: **v0.1**. Decisões de hospedagem concretas (fornecedor) ficam como **escolha operacional** na Fase 16/M0; aqui só requisitos.

## 1. Serviços

| Serviço | Imagem/Tecnologia | Função | Estado |
|---|---|---|---|
| `api` | Node LTS (imagem própria) | HTTP | stateless, 1+ réplicas |
| `worker` | mesma imagem, outro comando | Jobs | 1 instância (jobs idempotentes permitem mais) |
| `postgres` | PostgreSQL 16 | Dados | persistente, backups |
| `redis` | Redis 7 | BullMQ, rate limit | persistência AOF opcional; perda tolerável |
| `object-storage` | MinIO (dev) / S3-compatível na UE (prod) | Documentos e exportações | persistente, versionado, SSE |
| `clamav` | clamd | Antivírus | atualização diária de assinaturas |
| `proxy` | Caddy/Nginx/Traefik | TLS, compressão, limites de corpo | |
| `mail` | MailHog (dev) / SMTP UE (prod) | E-mail | |

## 2. Requisitos de localização e segurança (N5, NFR-PRV-02)
- Todos os dados (BD, objetos, backups) em região **UE**.
- TLS em todo o tráfego externo; rede interna privada (BD, Redis, storage e ClamAV **sem** portas públicas).
- Encriptação em repouso ao nível do disco/volume e do armazenamento de objetos (SSE); backups encriptados.
- Segredos em variáveis de ambiente injetadas pelo orquestrador/gestor de segredos; nunca no repositório.

## 3. Dimensionamento inicial (N9: 1 000 famílias / 5 000 utilizadores)
Um host com 2–4 vCPU e 8 GB RAM é suficiente para api+worker+postgres+redis+clamav; ClamAV usa ~1–2 GB RAM. Separar BD e storage geridos quando o orçamento permitir. Estimativa, **a validar com teste de carga** (M10).

## 4. Notificações externas
- **E-mail:** fornecedor SMTP com tratamento de dados na UE e DPA (acordo de subcontratação) assinado.
- **Push:** Web Push (VAPID). Os pedidos passam por serviços dos fabricantes de browsers (Google/Apple/Mozilla), fora do nosso controlo e possivelmente fora da UE: por isso o *payload* é **genérico, sem dados de saúde** (N8). Risco registado em `privacy.md`.

## 5. Ambientes (detalhe em `10-operations`)
`local` (Docker Compose) · `test` (CI, efémero) · `staging` (dados sintéticos) · `production`.

## 6. Pontos de extensão preparados (sem implementar)
Canal SMS (`NotificationChannel`) · replicação de leitura da BD · scale-out do worker · extração de `notifications` em serviço.
