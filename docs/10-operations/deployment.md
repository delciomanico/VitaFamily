# Vita Family — Deploy (Fase 16)

> **ATUALIZAÇÃO 2026-10-04 (ADR-012, decisão do proprietário):** a implementação é em **Go** (pgx+sqlc+goose, river, chi+oapi-codegen), **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz NestJS, Prisma, Redis, BullMQ ou Jest, ler o equivalente Go de ADR-012; a arquitetura lógica mantém-se.

> Estado: **v0.1**.

## 1. Artefactos
- **Imagem Docker única** (api e worker partilham-na; muda o comando): multi-stage, utilizador não-root, imagem base mínima fixada por *digest*, sem *devDependencies*, sem segredos.
- **Compose** em desenvolvimento e staging; em produção, orquestração simples (Compose em host ou serviço de contentores gerido na UE) `[escolha operacional TBD]`.

## 2. Pipeline CI/CD (proposta)
```text
PR → lint + tipos → unitários → integração (Testcontainers) → API/contrato →
     segurança (SCA, secrets, suite de isolamento) → verificação de arquitetura e drift de migrações → build da imagem
merge em main → publicar imagem (tag = commit) → deploy automático em staging → E2E de cenário
release (tag) → aprovação manual → deploy em produção
```

## 3. Passos de deploy em produção
1. Verificar backup recente e restauro testado (§ `monitoring.md`).
2. `prisma migrate deploy` (migração **compatível com a versão anterior**: expand/contract, `migrations.md`).
3. Arrancar nova versão do **worker** e da **api**; *health/readiness* verdes.
4. Smoke tests (login, criar membro, confirmar toma em conta de teste dedicada, `GET /health/ready`).
5. Monitorizar 30 min (erros, latência, fila de notificações).
6. **Rollback:** reverter imagem; migrações são compatíveis para trás; se uma migração destrutiva falhar, restaurar backup (RTO ≤ 8 h).

Disponibilidade-alvo 99,5 %/mês permite janelas curtas de manutenção; deploys normais não devem exigir indisponibilidade (API stateless; worker reinicia sem perder trabalho porque o estado está na BD).

## 4. TLS e rede
Proxy reverso termina TLS (certificados automáticos), HSTS, redirecionamento HTTP→HTTPS, limite de corpo (≤ 11 MB no caminho de upload; 1 MB nos restantes). Postgres, Redis, storage e ClamAV em rede interna sem portas públicas.

## 5. Backups e restauro (N10)
| Item | Política |
|---|---|
| PostgreSQL | Backup completo diário + arquivo de WAL (restauro a ponto no tempo opcional); retenção **30 dias**; **RPO ≤ 24 h** (melhorável com WAL). Encriptado, na UE. |
| Objetos (documentos, exportações) | Versionamento + cópia para segundo *bucket* na UE; retenção alinhada a 30 dias para versões apagadas. |
| Redis | Sem backup obrigatório (não é fonte de verdade). |
| Restauro | Ensaiado em staging **trimestralmente** e antes de cada release maior; **RTO ≤ 8 h**; procedimento escrito. |
| Apagamento (N6) | Dados eliminados desaparecem dos backups por expiração em ≤30 dias; **não** se restaura um backup para recuperar dados apagados a pedido do titular sem reaplicar os apagamentos (registo de apagamentos a reaplicar `[procedimento operacional]`). |

## 6. Gestão de alterações
Mudanças de infraestrutura e de configuração seguem o mesmo controlo de alterações; alterações a decisões documentadas exigem ADR.
