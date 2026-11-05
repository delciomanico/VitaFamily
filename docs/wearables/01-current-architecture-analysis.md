# 01 — Análise da arquitetura atual e pontos de integração

> Estado: **proposta para decisão do proprietário** (change control pendente, ver `07-open-questions.md`).
> Legenda: **[F]** facto confirmado no código/docs · **[H]** hipótese · **[P]** pendente.
> Decisão do proprietário: os dados do relógio **não se misturam** com os dados de saúde da app; o frontend terá uma zona "Relógio" dedicada.

## 1. Âmbito atual
- **[F]** Wearables/IoT estão `[OUT]` do MVP (`docs/00-product/scope.md:32`, `docs/00-product/discovery.md:134`). Não existe nenhuma referência a Health Connect, smartwatch ou sincronização de dispositivos nos docs. Isto exige change control + ADR (precedentes: ADR-021, 022, 023).
- **[F]** Último ADR existente: 024 (marcação presencial); o próximo livre é o 025.

## 2. Aplicação móvel / frontend (`apps/web`)
| Aspeto | Estado | Implicação |
|---|---|---|
| Shell nativo | **[F]** Capacitor 8, só Android (`apps/web/android`), `MainActivity` vazia, único plugin `@capacitor/app` | Nenhum código nativo para reaproveitar; o plugin Health Connect é novo |
| Carregamento | **[F]** `capacitor.config.ts` → `server.url = https://vitafamily.cassfrei.com` (WebView remoto) | O JS que chama o plugin vem do bundle de produção; o plugin exige novo APK. Versões de APK e web têm de ser compatíveis (verificar presença do plugin em runtime) |
| Android | **[F]** minSdk 24, target/compile 36, manifest só `INTERNET`, sem WorkManager/FCM, só build debug (`README.md` §APK) | Precisa de permissões Health Connect, `<queries>`, atividade de rationale, release assinado |
| Stack web | **[F]** React 19, Vite 8, Tailwind 4, React Router 7, sem React Query; `useAsync`, `services/*.service.ts` com ramo mock/`apiFetch` | Seguir o mesmo padrão (service + mock + tipos) |
| Cliente API | **[F]** `src/lib/apiClient.ts` manual; tipos manuais em `src/types/*` | Sem tipos gerados no web |
| Auth no cliente | **[F]** access token em memória; refresh em cookie HttpOnly `Path=/api/v1/auth` | Código nativo em background **não** consegue usar a sessão (ver 05) |
| Persistência local | **[F]** sem IndexedDB/SQLite; `README` declara "sem dados de saúde nem tokens locais" | Buffer offline seria mudança de política → **[P]** |
| Gráficos | **[F]** só `TrendChart.tsx` (SVG, 1 série, exames) | Generalizar ou criar componente para séries do relógio |
| Navegação | **[F]** `components/layout/navigation.ts`, `routes/paths.ts`, `routes/router.tsx` (lazy) | Ponto de entrada da zona "Relógio" |
| Definições | **[F]** `pages/settings/*`; não existe ecrã de dispositivos | Zona nova, não reutilizável |
| Push | **[F]** só Web Push; sem FCM | Fora do MVP do relógio |
| Testes | **[F]** Vitest + Testing Library; maioria em `mocks/handlers/*.test.ts` | Mock handler de relógio + teste de fluxo |

## 3. Backend (`apps/api`)
- **[F]** Monólito modular Clean Architecture (ADR-015/016), 19 módulos em `src/modules/<m>/{domain,application,infrastructure,interface}`, ligação manual em `main/api.ts` (+ `worker.ts` para jobs).
- **[F]** Migrações SQL numeradas, próxima `0025`; Kysely com `declare module` por módulo; pg-boss para jobs.
- **[F]** Autorização única: `AccessPolicy.can()` (ADR-008). Relações `SELF`, `TUTOR_OF`, `DEPENDENT_SELF`, `OTHER`; categoria `data_category` (ALLERGIES, CONDITIONS, MEDICATION, APPOINTMENTS, EXAMS). Admin de plataforma é sempre negado a dados de saúde.
- **[F]** Auth: JWT HS256 15 min + refresh opaco em `sessions` (ADR-007). **Não existe** credencial de dispositivo/máquina. Existem identidades separadas para clínicas e seguradoras (ADR-020/021), com cookies e middleware próprios — precedente de isolamento.
- **[F]** `health-records` só tem alergias, condições e tipo sanguíneo; não há medições contínuas nem campos `source/external_id/device_id` em nenhuma tabela.
- **[F]** Padrões de idempotência existentes: `alerts.dedupe_key UNIQUE` (ADR-009), `dose_occurrences UNIQUE(plan_id, scheduled_at)`. `Idempotency-Key` está fora do MVP.
- **[F]** Tabelas por membro usam FK composta `(family_id, member_id) → family_members(family_id, id) ON DELETE CASCADE` → eliminação de membro/família/conta cobre as tabelas novas automaticamente.
- **[F]** `audit` tem lista fechada de `AuditAction` (`audit/domain/event.ts`) e catálogo em `docs/08-security/audit.md`; `metadata` nunca leva dados de saúde.
- **[F]** `reports` e `lifecycle` (exportação) agregam via `reads` de módulos concretos (`ReportSources`, `ExportSources`).
- **[F]** `tests/architecture-rules.ts` (`MODULE_DEPENDENCIES`, `HEALTH_MODULES`) tem de coincidir com `docs/06-architecture/modules.md`.
- **[F]** Contrato: `docs/05-api/openapi.yaml` (3.0.3, validado em runtime por express-openapi-validator); contrato primeiro, depois migração → domínio → casos de uso → adaptadores → controladores (`conventions.md`).

## 4. Reutilizar vs criar
**Reutilizar** (sem alteração): `AccessPolicy`, `withTransaction`, `audit.record`, `Clock`, `Page<T>`/cursor, `newId`, pg-boss, padrão de FK composta, padrão de migração, padrão mock/service do web, `useAsync`, rate limiting.
**Reutilizar com extensão mínima:** `AuditAction` (novas ações), `lifecycle` exportação (secção `relogio`), `architecture-rules.ts`/`modules.md`, navegação/rotas web.
**Criar:** módulo `wearables` (API), tabelas próprias, plugin Capacitor Kotlin, ecrãs "Relógio", componente de gráfico de séries, ADR-025.
**Não tocar (por decisão do proprietário):** `health-records`, `examinations`/`exam_results`, `reports` clínicos, `data_category`/`sharing_grants` (salvo decisão em 05), hub de saúde.

## 5. Pontos de integração (resumo)
1. Plugin nativo ↔ WebView (Capacitor bridge).
2. Web (`services/wearables.service.ts`) ↔ API `/api/v1/...` (nova família de endpoints isolada).
3. `AccessPolicy` para decidir quem vê/gere os dados de um membro.
4. `lifecycle` (exportação e eliminação) e `audit`.
5. Teste de arquitetura e `modules.md`.

## 6. Lacunas de informação (não derivam do código)
- **[P]** Dispositivos reais disponíveis para testes e marcas-alvo.
- **[P]** Distribuição Android: APK direto ou Google Play (condiciona a declaração Health Connect).
- **[P]** Se utilizadores com dependentes/menores podem ligar relógios de dependentes.
- **[P]** Volume esperado de dados e política de retenção.
