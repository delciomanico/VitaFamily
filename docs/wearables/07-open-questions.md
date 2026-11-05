# 07 — Questões em aberto

**Bloqueantes** (B) têm de ser decididas antes da fase 3; as restantes antes da fase indicada.

## Bloqueantes
| # | Questão | Porquê | Recomendação |
|---|---|---|---|
| B1 | Aprovar change control: wearables saem de `[OUT]` em `scope.md`/`discovery.md`? | `CLAUDE.md`: alterações só por decisão do proprietário | Aprovar com ADR-025 |
| B2 | Distribuição Android: APK direto ou Google Play? | Play exige declaração Health Connect e apps de saúde; APK direto não | Decidir cedo; preparar para Play |
| B3 | Quem pode ligar um relógio a um dependente/menor? | Consentimento e matriz `DEPENDENT_SELF` | Só o próprio adulto e o tutor |
| B4 | Que dispositivos/apps reais temos para testar (marca, modelo, Android)? | Validação da fase 4 e do spike | Mín. 3 marcas |
| B5 | AIPD: cobrir wearables na AIPD pendente; base legal (consentimento explícito) | Dados de saúde, categoria especial | Concluir antes do go-live |

## Fase 2
- Manter minSdk 24 e ocultar a funcionalidade abaixo do mínimo do Health Connect, ou subir minSdk? (SDK min 26; Health Connect requer Android 9+/API 28.)
- Plugin próprio em Kotlin vs plugin Capacitor de terceiros mantido e auditável? (Preferência: próprio.)
- Pressão arterial: duas amostras (sistólica/diastólica) ou `value_json`?
- Lista definitiva de tipos do MVP e intervalos plausíveis por tipo.
- Compatibilidade APK ↔ bundle remoto: política de versão mínima do plugin.

## Fase 3
- Granularidade de HR a enviar (bruta/1 min/5 min) e retenção do bruto.
- Retenção por defeito dos dados do relógio (por exemplo 12 meses) e apagamento automático.
- Texto de consentimento (versão, idioma pt-PT) e política de privacidade/rationale do Health Connect.
- Fonte prioritária quando várias apps escrevem o mesmo dado (escolha do utilizador?).
- Limite de tamanho do pacote de exportação com séries longas.
- Nome final da zona ("Relógio") e posição na navegação.

## Fase 5
- Política "sem dados locais" vs buffer offline para background.
- Credencial de dispositivo (formato, rotação, revogação) — ADR próprio.
- Partilha dos dados do relógio com familiares: nova `data_category`? Impacto em `category-matrix.ts`, `authorization.md`, OpenAPI e testes de matriz.
- Alertas ou resumos derivados do relógio (reabre BR-RPT-03 / ADR-009 / ADR-022).
- iOS/HealthKit: necessidade real?
- SDKs/APIs de fabricantes: elegibilidade, custos, termos e retenção (não verificados).

## Informação não disponível no código
- Tráfego e volume previstos de utilizadores com relógio.
- Marcas-alvo prioritárias.
- Infraestrutura de CI para assinar e publicar APK release (hoje só debug).
- Estado da AIPD e do registo de tratamentos.
