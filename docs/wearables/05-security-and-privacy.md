# 05 — Segurança e privacidade

**[F]** = confirmado no código/docs · **[H]** = hipótese · **[P]** = pendente. Dados de saúde são categoria especial RGPD; a AIPD do projeto continua pendente (`docs/08-security/privacy.md`) e terá de cobrir esta funcionalidade.

## 1. Consentimento
- Consentimento **explícito e específico** antes de qualquer pedido de permissão Android: o que se lê (tipos), para quê, onde fica, como revogar. Registado em `wearable_consents` (quem, quando, tipos, versão do texto).
- Independente dos Termos e do consentimento de IA (ADR-022): os dados do relógio **não** vão para IA.
- Consentir ≠ conceder permissão Android: são dois passos; sem consentimento não se invoca o plugin.
- Dependentes/menores: quem consente é o tutor (`TUTOR_OF`); `DEPENDENT_SELF` não liga relógios no MVP **[P]** (decisão do proprietário; alinhar com a matriz em `authorization.md`).

## 2. Permissões Android
- Só `READ_*` dos tipos suportados, nunca `WRITE_*`. Sem `READ_HEALTH_DATA_HISTORY` no MVP (limite de 30 dias por defeito) e sem leitura em background no MVP (`READ_HEALTH_DATA_IN_BACKGROUND` fica para a fase 5). **[F]** estas são permissões distintas das de tipo de dados.
- Atividade de rationale com política de privacidade (exigida pelo Health Connect).
- Se o utilizador negar tipos, a UI funciona com os concedidos; nunca insistir em loop.
- Play Store: declaração Health Connect + declaração de apps de saúde se distribuído pela Play **[P]**.

## 3. Autenticação e autorização no backend
- **MVP:** os endpoints usam o JWT de utilizador existente (Bearer, 15 min) — a sincronização acontece com a app aberta. **Sem nova credencial**.
- **[F]** Em background o cookie de refresh HttpOnly não é acessível ao código nativo. **Fase 5:** credencial **por dispositivo** (token opaco de alto entropia, hash em BD, âmbito limitado a `POST /samples:ingest` da sua fonte, revogável, rotação) — novo desenho com ADR próprio; precedente de identidades separadas: ADR-020/021.
- Autorização: **toda** a operação passa por `AccessPolicy.can()` com o `subjectMemberId`; repositórios exigem `familyId` (convenção). Admin de plataforma **nunca** acede (D4); o módulo `admin` não importa `wearables`.
- Decisão sobre a categoria: **sem** novo valor em `data_category` no MVP (evita expor aos grants `OTHER` e mexer na matriz); acesso só do próprio/tutor. Se o proprietário quiser partilha familiar, terá de ser nova categoria com migração + `category-matrix.ts` + `authorization.md` + teste de matriz. **[P]**
- Isolamento: FK composta `(family_id, member_id)`; testes de isolamento obrigatórios (um membro nunca lê/escreve noutro; tutor só dos seus tutelados; outro familiar sem grant → 403/404).
- Rate limit específico à ingestão e tamanho máximo de lote.

## 4. Transmissão e armazenamento
- TLS (Traefik/Dokploy, ADR-017); API atrás do proxy do web (ADR-019). Sem dados do relógio em logs, erros, métricas, push ou e-mail (alinhado com N8; teste de dado canário).
- Em repouso: Postgres da VPS; **[P]** confirmar cifragem de disco/backups (`security.md`); cifragem de coluna não proposta (sem precedente no projeto; avaliar na AIPD).
- No telemóvel: **nada persistido** pelo plugin (lê e devolve); cursores no servidor.

## 5. Revogação e eliminação
- "Desconectar" revoga a fonte e o consentimento; o plugin pede a revogação de permissões no Health Connect; a API deixa de aceitar ingestão dessa fonte.
- "Apagar dados do relógio" (por fonte ou total): eliminação real, imediata, auditada (ADR-011: hard delete).
- Eliminação de conta/membro/família: cascade FK (já padrão do projeto).
- Exportação RGPD: secção `relogio` no pacote de `lifecycle`.
- Pedido de apagamento/portabilidade cobertos por estes dois mecanismos.

## 6. Auditoria
Novas `AuditAction` (a acrescentar em `audit/domain/event.ts` e `audit.md`): `WEARABLE_CONSENT_GRANT/REVOKE`, `WEARABLE_SOURCE_CONNECT/DISCONNECT`, `WEARABLE_DATA_DELETE`, `WEARABLE_DATA_EXPORT`, e `WEARABLE_VIEW` para leituras por quem não é o próprio (tutor). Ingestão de lotes **não** gera um evento por amostra (evita ruído): 1 evento de resumo por sincronização sem valores. `metadata` nunca contém valores de saúde.

## 7. Minimização
Tipos mínimos necessários; agregação de HR; sem GPS/rotas; sem identificadores de hardware; retenção limitada **[P]**; sem envio a terceiros.

## 8. Não-diagnóstico
UI e relatórios sem classificações clínicas ("normal", "arritmia", "risco"). Aviso fixo: informação de bem-estar, não substitui aconselhamento médico. Sem alertas automáticos baseados em valores do relógio no MVP (BR-RPT-03; evitar reabrir ADR-009 para este fim).

## 9. Registo de riscos
| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | Acesso indevido entre membros da família | Baixa | Crítico | `AccessPolicy` + FK composta + testes de matriz/isolamento |
| R2 | Dados de terceiros/estimados lidos como clínicos | Média | Alto | Rótulo de origem, sem interpretação, aviso |
| R3 | Fuga via logs/erros | Baixa | Alto | Teste canário, sem valores em `metadata` |
| R4 | Credencial de dispositivo roubada (fase 5) | Baixa | Alto | Âmbito mínimo, revogação, rotação, hash |
| R5 | Rejeição na Play (declaração HC) | Média | Médio | Preparar justificação; alternativa APK direto |
| R6 | Cobertura de dispositivos menor que o esperado | Alta | Médio | Validar com hardware real na fase 4; UI por capacidades |
| R7 | Duplicação/dupla contagem (várias apps) | Média | Médio | Chave natural + fonte prioritária |
| R8 | Volume de HR sobrecarrega BD/exportação | Média | Médio | Agregação, retenção, paginação, limite de zip |
| R9 | Incompatibilidade APK ↔ bundle web remoto | Média | Médio | Detetar plugin em runtime, versão mínima, degradar |
| R10 | AIPD/base legal por concluir | Média | Alto | Bloquear go-live até concluir (como ADR-022) |
