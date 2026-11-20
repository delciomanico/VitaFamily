# Módulo `record-sharing`

MK4 do mercado de profissionais (ADR-037 §8, ADR-016; `modules.md` nota 38; `plan.md` «MK4»). Dono das tabelas `record_shares` e `record_share_views` (migração `0046`). A família partilha **categorias** de registos de um membro com o profissional de uma marcação confirmada, com prazo e, se quiser, de visualização única; o profissional abre; a família vê cada abertura e pode revogar.

## Responsabilidade

- **Família** (`SELF`/`TUTOR_OF`, ação `SHARE_WITH_PROFESSIONALS`): opções, criar, listar, ver, ver as vistas («quem viu») e revogar, em `/families/{f}/members/{m}/record-shares*`. `DEPENDENT_SELF` e `OTHER` ⇒ `FORBIDDEN`; quem lê por `SharingGrant` **não** partilha.
- **Profissional** (token de `ProfessionalAccount`; procura sempre por `professionalId` do token): lista, detalhe (só metadados) e **abrir** em `/professional-portal/shares*`. Abrir reavalia tudo a cada pedido (estado, prazo, profissional `APPROVED`, marcação `CONFIRMED`/`COMPLETED`, membro `ACTIVE`, categorias) e devolve o conteúdo **lido no momento**, só das categorias concedidas, com marca de água e `ageYears`.
- **Jobs**: aviso genérico ao profissional por partilha nova; expurgo diário por retenção (24 meses depois do fim).
- **Exportação**: `reads.recordShares` é a fonte `recordShares` da exportação do titular, ligada a `lifecycle` em `main/api.ts` (sem `lifecycle` importar este módulo).
- **Fora deste módulo**: a receita digital vive em `consultations`/`prescriptions` (porta `PrescriptionIssuer`); `admin` não tem nenhuma rota de partilhas.

## Mapa de pastas

```
index.ts          raiz pública (só `main/` a importa): createRecordSharingModule, createRecordSharingWorkerModule,
                  createRecordSharingMaintenance, createSharedRecordsReader, PgBossShareNotices, SmtpShareNoticeMailer, domain/
domain/           funções puras (sem Date.now/Math.random; o instante entra por parâmetro): share (prazo, categorias, estado derivado,
                  evaluateOpen/canRevoke), age (idade em anos completos em Africa/Luanda)
application/      family-shares, professional-shares, shared-records (leitor composto), views, export, maintenance, rate-limit,
                  cursor + ports.ts
infrastructure/   repo.ts, maintenance-repo.ts (Kysely), jobs.ts e workers.ts (pg-boss), mailer-smtp.ts (Nodemailer), schema.ts
interface/        family-router, professional-router, http-helpers (Express)
```

## Portas e ferramentas substituíveis

O módulo só importa `audit` e `platform`; tudo o resto entra por portas definidas em `application/ports.ts` e ligadas em `main/api.ts`/`main/worker.ts`.

| Porta | Implementação | Substituível por |
|---|---|---|
| `ShareAccess` | `access.policy.can(..., "SHARE_WITH_PROFESSIONALS")` | outra política de autorização |
| `ShareAnchor` (marcação-âncora, categoria da especialidade, estado atual) | `consultations.shareAnchor` | qualquer fonte de marcações |
| `ShareProfessionals` (nome público, cidade, `approved` lido agora) | `professionals.directory` | idem |
| `ShareMembers` (membro `ACTIVE`) | `families.findMemberById` | idem |
| `SharedRecordsReader` (uma só, composta sobre as leituras públicas dos módulos de saúde: `SharedRecordsSources`) | `createSharedRecordsReader` | outro leitor; sem `AccessPolicy` (a autorização é a partilha) |
| `RecordShareRepository` | `KyselyRecordShareRepository` (PostgreSQL) | outra base de dados |
| `ShareNotices` | `PgBossShareNotices` (fila `record-sharing.notify-professional`, `singletonKey` = `shareId`) | outra fila |
| `ShareMailer` | `SmtpShareNoticeMailer` (texto fixo) | outro fornecedor de e-mail |
| `RateLimiter` (platform, namespace `record-sharing`) | adaptador Redis em produção; memória nos testes | só pela porta assíncrona, falha fechada |

## Concorrência

- **Abrir** corre numa só transação: `SELECT … FOR UPDATE` da partilha (serializa aberturas e revogações), reavaliação, leitura do conteúdo e **um** `UPDATE` condicional que incrementa `view_count` e, em visualização única, passa a `CONSUMED`; a vista e a auditoria `SUCCESS` entram na mesma transação. Falhar a leitura ⇒ rollback: nada se consome. A recusa audita-se (`DENIED`) em transação própria.
- **Criar** serializa-se por bloqueio consultivo do membro e do utilizador (20 ativas por membro, 20 criações/dia, sem corridas); `clientRequestId` é único por membro (idempotência). A BD é a rede: `CHECK` de prazo ≤ 30 dias e de consistência de estado; trigger que torna a partilha imutável (só estado, contadores e autoria mudam; um estado terminal não muda); `record_share_views` é imutável.
- **Revogar** bloqueia a linha: a abertura seguinte vê `REVOKED`.
- As leituras por outra ligação do pool (identidade do profissional, categoria da especialidade) fazem-se **antes** de abrir a transação, para o portão de `platform/db` não deixar o pool esgotar.

## Privacidade (BR-MKT-75)

- O profissional recebe só `participantLabel`, `ageYears` e os metadados; nunca ids de família, membro nem utilizador, nome, data de nascimento nem ids de registos de saúde. A família nunca vê a autoria da criação.
- Conteúdo, rótulo, categorias lidas e idade **nunca** vão para logs, erros, auditoria (`metadata` só leva contagens e modos), alertas, avisos, e-mails nem *query string*; nada disto se guarda (`record_shares` e `record_share_views` não têm coluna de conteúdo nem de idade).
- Todas as respostas levam `Cache-Control: no-store`; a abertura, também sem ETag. Esta é a **única** exceção a BR-PRV-09: o titular/tutor vê as aberturas dos profissionais às suas partilhas (BR-MKT-73).
- Testes: `tests/integration/mk4-{openapi,idor,pii-canary,flow}.integration.test.ts` e `tests/record-sharing-architecture.test.ts`.
