# 02 — Estratégia de integração

Legenda: **[F]** confirmado (código ou documentação oficial consultada em 2026-11-05) · **[H]** hipótese · **[P]** pendente.

## 1. Opções avaliadas

### A. Android Health Connect (recomendada)
Armazém de dados de saúde on-device do Android; as apps dos fabricantes (Samsung Health, Fitbit, Garmin Connect, Xiaomi/Zepp, etc.) escrevem lá, e a nossa app lê com permissão do utilizador.

- **[F]** Android 14+ (API 34): Health Connect faz parte do framework. Android 13 e inferior: app a instalar da Play Store; o SDK `androidx.health.connect:connect-client` suporta minSdk 26, mas o Health Connect exige Android 9+ (API 28). `HealthConnectClient.getSdkStatus()` devolve `SDK_AVAILABLE`, `SDK_UNAVAILABLE` ou `SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED`.
- **[F]** Tipos relevantes existem: frequência cardíaca, passos, sessões de sono, SpO₂, pressão arterial, calorias ativas, sessões de exercício (lista exata de tipos a confirmar na fase 2 contra a versão do SDK escolhida).
- **[F]** Permissões por tipo de dado (`READ_*`), declaradas no manifest e pedidas em runtime. Cada leitura está limitada, por defeito, a **30 dias antes da primeira permissão concedida**; mais histórico exige `READ_HEALTH_DATA_HISTORY`. Leitura em background exige permissão adicional própria (`READ_HEALTH_DATA_IN_BACKGROUND`) e a app deve funcionar se for negada.
- **[F]** Sincronização incremental: Changes API (`getChangesToken` / `getChanges`); token **expira ao fim de 30 dias** → `changesTokenExpired` ⇒ reler os últimos 30 dias e deduplicar.
- **[F]** Cada registo tem metadados: `dataOrigin` (app de origem), `clientRecordId`, `lastModifiedTime`, `recordingMethod`, `device`. Servem para proveniência e dedup.
- **[F]** Publicação na Google Play: declaração Health Connect no Play Console (tipos e justificação, uso mínimo, consentimento para partilha com terceiros). Apps sujeitas a casos de uso aprovados.
- **[H]** Cobertura de fabricantes depende de a app do fabricante escrever no Health Connect; nem todas escrevem todos os tipos (ex.: SpO₂, pressão arterial são raros).
- **[F]** Limitação inevitável: o Health Connect **não é** uma ligação ao relógio; se o utilizador não tiver a app do fabricante instalada e a sincronizar, não há dados.

### B. BLE direto
- **[F]** Só perfis GATT padronizados são universais (ex.: Heart Rate Service 0x180D). Passos, sono, SpO₂ e calorias nos relógios comerciais são normalmente protocolos **proprietários** por fabricante.
- **[F/H]** Relógios normalmente aceitam um único "mestre" de sincronização: ligar a nossa app pode **desligar a app oficial** do fabricante. Pareamento/bonding e reconexão em background exigem foreground service e permissões `BLUETOOTH_SCAN/CONNECT` (Android 12+), localização em versões anteriores, e sofrem limites de otimização de bateria por fabricante Android.
- **Conclusão:** só fornece frequência cardíaca em tempo real em alguns dispositivos. Não é solução universal; **fora do MVP**.

### C. SDKs/APIs de fabricantes
- Exemplos a avaliar caso a caso na fase 5: Garmin Health API (acordo comercial), Fitbit Web API / Google Health API (OAuth cloud, política de dados), Samsung Health SDK/Data (parcerias), Huawei Health Kit, Polar AccessLink, Withings.
- **[P]** Termos comerciais, aprovação, custos e retenção de dados de cada um não foram verificados — **não assumir que existem ou estão acessíveis** sem confirmação por fabricante.
- Vantagens: dados mais ricos e fiáveis; sem dependência de Health Connect. Desvios: contrato por fabricante, OAuth cloud-to-cloud, transferência de dados a terceiros (RGPD), manutenção por API.

### D. Protocolos proprietários
- Só via adaptadores isolados por marca, com *feature flag*, testados com hardware real. **Engenharia reversa não é recomendada** (risco legal, segurança, quebra a cada firmware, impossível de validar clinicamente).

## 2. Matriz de compatibilidade (qualitativa)
| Critério | Health Connect | BLE padrão | SDK/API fabricante | Proprietário |
|---|---|---|---|---|
| Multi-marca com 1 integração | **Alta** | Baixa | Nenhuma (1 por marca) | Nenhuma |
| Frequência cardíaca | Sim (se app escreve) | Sim (0x180D, em alguns) | Sim | Variável |
| Passos/atividade | Sim | Raro (padrão) | Sim | Variável |
| Sono | Sim | Não padrão | Sim | Variável |
| SpO₂ | Sim, se app escrever (raro) | Não padrão | Alguns | Variável |
| Pressão arterial | Só se dispositivo/app fornecer | Perfil BP (raro em relógios) | Alguns | Variável |
| Histórico | 30 dias por defeito; mais com permissão | Limitado (buffer do relógio) | Depende | Depende |
| Background | Possível (permissão própria, WorkManager) | Difícil (foreground service) | Servidor→servidor | Difícil |
| Esforço (app) | **Médio** (1 plugin) | Alto | Alto por marca | Muito alto |
| Risco de manutenção | Baixo (API estável do Google) | Médio | Alto | Muito alto |
| Dependência comercial | Nenhuma | Nenhuma | **Sim** | — |
| Requisito de loja | Declaração Play | Permissões BLE | Contrato | — |

## 3. Limitações inevitáveis
1. Sem app do fabricante a escrever no Health Connect, não há dados por essa via.
2. Nem todos os dispositivos fornecem todos os tipos; a UI tem de ser **dirigida por capacidades detetadas**.
3. Health Connect é só Android (iOS/HealthKit exigiria outro caminho — fora do âmbito).
4. Dados de Health Connect de terceiros são **dados de terceiros**; a qualidade e a origem (medido vs estimado) são as declaradas pela app de origem, não garantidas por nós.
5. Dados do relógio não são diagnóstico; não se interpretam clinicamente (cf. BR-RPT-03).

## 4. Recomendação final
1. **MVP = Health Connect** com plugin Capacitor Kotlin próprio, sincronização **oportunista com a app aberta** (Changes API) — reutiliza a sessão atual, sem nova credencial.
2. **Fase 5 (expansão):** sincronização em background (credencial por dispositivo), depois BLE padrão para HR e, por fabricante, SDKs/APIs oficiais conforme necessidade e viabilidade comercial.
3. **Rejeitado:** engenharia reversa; "ligação Bluetooth universal".

## 5. Verificação pendente (antes da fase 3)
- **[P]** Versão exata do `connect-client` e lista de tipos/permissões no momento da implementação.
- **[P]** Existência de plugin Capacitor mantido para Health Connect vs plugin próprio (preferência: próprio, superfície mínima; avaliar apenas se houver plugin mantido e auditável).
- **[P]** Requisitos atuais da Play para a declaração, se a distribuição for pela Play.

## Fontes oficiais consultadas
- https://developer.android.com/health-and-fitness/health-connect/sync-data
- https://developer.android.com/health-and-fitness/health-connect/read-data
- https://developer.android.com/health-and-fitness/health-connect/data-types
- https://developer.android.com/health-and-fitness/health-connect/get-started
- https://developer.android.com/health-and-fitness/health-connect/publish
- https://support.google.com/googleplay/android-developer/answer/16558241
