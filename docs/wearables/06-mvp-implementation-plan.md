# 06 — Plano de implementação do MVP

**Nada disto começa sem aprovação do proprietário** (change control + ADR-025). Ordem de trabalho do projeto (`conventions.md`): contrato → migração → domínio → casos de uso → adaptadores → controladores → testes → auditoria → README do módulo.

## MVP recomendado
Zona **"Relógio"** (Android, Health Connect): ligar fonte, consentir, sincronizar com a app aberta, ver painel e métricas (HR, passos, sono; SpO₂/PA/calorias/exercício só se existirem dados), desconectar e apagar. **Fora do MVP:** background, BLE, SDKs de fabricantes, partilha familiar, alertas, IA, relatórios clínicos, iOS.

## Fases e critérios de passagem

### Fase 1 — Análise (esta etapa)
Entregável: `docs/wearables/01–07`. **Passa quando:** proprietário aprova o âmbito (separação dos dados, só Android, Health Connect) e decide as questões bloqueantes de `07` (B1–B5).

### Fase 2 — Definição técnica
- ADR-025 + change control (scope, `plan.md` novo milestone, `modules.md`, `audit.md`, `authorization.md`, `privacy.md`, `endpoints.md`).
- Contrato OpenAPI (`wearables` tag), unidades/tipos, matriz de limites, texto de consentimento.
- Spike de 1–2 dias: plugin Kotlin mínimo lê HR/passos num telemóvel real; confirma tipos de `dataOrigin`/`recordingMethod`, minSdk e comportamento do WebView remoto com o plugin.
**Passa quando:** docs e ADR aprovados; `pnpm gen` compila; spike confirma leitura real e identifica o impacto de minSdk.

### Fase 3 — MVP (por incrementos)
| # | Incremento | Camada | Prioridade |
|---|---|---|---|
| 3.1 | Migração `0025` + módulo `wearables` (domínio, ingestão idempotente, consent, fontes) + auditoria + testes unitários e de matriz | API | P0 |
| 3.2 | Endpoints + validação OpenAPI + testes HTTP e de integração (testcontainers) + teste de arquitetura | API | P0 |
| 3.3 | Plugin Kotlin `VitaHealthConnect` + manifest + build release assinado | Android | P0 |
| 3.4 | Service + mock + páginas Conectar/Painel/Métricas/Desconectar | Web | P0 |
| 3.5 | Exportação RGPD `relogio` + eliminação + purga por retenção | API | P1 |
| 3.6 | Estados de erro (HC indisponível, permissão negada, token expirado) e textos pt-PT | Web | P1 |
**Passa quando:** todos os critérios de aceitação abaixo verdes + revisão `vita-qa-security`.

### Fase 4 — Validação
Hardware real (mín. 3 marcas/apps diferentes **[P]**), Android 13 (HC via Play) e 14+ (framework), permissões parciais, desinstalar/reinstalar, token expirado (30 dias simulados), dupla fonte, dados duplicados, app em segundo plano/aberta, rede intermitente, revogação e eliminação, APK vs bundle antigo.
**Passa quando:** zero duplicados em reenvio; ≥ 95% das amostras reais aceites em todos os dispositivos de teste; nenhum acesso cruzado; nenhum dado em logs; AIPD concluída; decisão de distribuição (Play/APK) tomada.

### Fase 5 — Expansão
Por ordem: (a) sync em background com credencial de dispositivo (ADR próprio); (b) leitura de histórico (`READ_HEALTH_DATA_HISTORY`); (c) BLE padrão HR; (d) SDKs/APIs de fabricantes, uma de cada vez, com avaliação comercial e RGPD; (e) partilha familiar/categoria `data_category` se decidida; (f) iOS/HealthKit se houver necessidade.
**Cada expansão só avança com:** dispositivo real de teste, avaliação de privacidade, adaptador isolado atrás de `source_kind`, flag de ativação.

## Critérios de aceitação (MVP)
- AC-W1: sem consentimento registado, o plugin não é invocado e a API recusa ingestão.
- AC-W2: reenviar o mesmo lote 3× resulta em 0 duplicados (`UNIQUE` + upsert).
- AC-W3: membro A nunca lê/escreve dados de B; tutor só dos tutelados; admin de plataforma → 403.
- AC-W4: a UI só mostra tipos suportados e concedidos; HC indisponível mostra instruções, não erro genérico.
- AC-W5: "Desconectar" pára ingestão; "Apagar" remove todas as amostras da fonte; verificável por consulta e exportação.
- AC-W6: eliminação de conta/membro apaga todas as tabelas `wearable_*` (cascade).
- AC-W7: nenhum valor de saúde em logs, `audit.metadata`, erros ou métricas (teste canário).
- AC-W8: dados do relógio **não** aparecem em hub de saúde, relatórios clínicos nem `exam_results`.
- AC-W9: valores fora do intervalo plausível são rejeitados e contados, nunca alterados.
- AC-W10: origem (`origin`) visível em cada métrica.

## Testes
- **Unit/domínio:** validação de unidade/intervalo por tipo, classificação de `origin`, chave de dedup (`it.each`).
- **Aplicação:** `FakeAccessPolicy`/`FakeAudit` (padrão `fixtures.ts`), consent, ingestão, revogação.
- **Integração:** Postgres real: unicidade, cascade, índices, migração (`migrate-runner.test.ts`).
- **HTTP:** Supertest + OpenAPI; rate limit; tamanhos de lote.
- **Segurança (qa-security):** matriz de autorização, isolamento, canário em logs.
- **Arquitetura:** `wearables` fora de `HEALTH_MODULES`, sem imports de módulos clínicos.
- **Web:** mock handler tests + fluxo de rotas; estados de erro.
- **Android:** testes instrumentados do plugin com Health Connect de teste; validação manual em dispositivos reais (checklist).

## Estimativa de risco por prioridade
Maior risco técnico: comportamento real de `dataOrigin`/`recordingMethod` entre marcas e plugin ↔ WebView remoto. Por isso o **spike** da fase 2 precede qualquer investimento em backend.

## Equipa (agentes do projeto)
`vita-architect` (ADR, docs), `vita-platform` (módulo/infra base), `vita-health`/novo agente wearables ou `vita-lifecycle` (exportação), `vita-qa-security`, `vita-devops` (build release assinado, CI do APK).
