# Vita Family — Casos de teste (Fase 15)

> Estado: **v0.1**. Catálogo (não exaustivo) dos casos que devem existir antes do M10. Nível: **U** unitário, **I** integração, **A** API/E2E, **S** segurança, **L** carga. Cada caso liga a critérios (`AC-*`) e requisitos.

## 1. Autenticação e conta (TC-AUTH)
| ID | Caso | Nível | Liga a |
|---|---|---|---|
| TC-AUTH-01 | Registo válido; e-mail de verificação; login só após verificar | A | AC-ACC-01 |
| TC-AUTH-02 | Registo com <18 anos recusado; dependente via convite com ≥13 aceite, <13 recusado | A | AC-ACC-02, AC-MEM-05 |
| TC-AUTH-03 | Registo de e-mail existente devolve resposta idêntica (tempo e corpo) | S | AC-ACC-03 |
| TC-AUTH-04 | Política de palavra-passe (11 caracteres falha, comum falha, 12 válida) | U | NFR-SEC-03 |
| TC-AUTH-05 | Login: credenciais inválidas genérico; conta não verificada; suspensa | A | AC-ACC-04 |
| TC-AUTH-06 | Rate limit de login (5 falhas/15 min) e de registo/recuperação | S | NFR-SEC-05 |
| TC-AUTH-07 | Refresh rotativo; reutilização revoga a cadeia | S | AC-ACC-07 |
| TC-AUTH-08 | Access token expirado ⇒ `TOKEN_EXPIRED`; sem papéis no token | A | ADR-007 |
| TC-AUTH-09 | Recuperação: token de uso único, 1 h, revoga sessões | A | UC-ACC-03 |
| TC-AUTH-10 | Reaceitação de termos bloqueia API exceto 3 operações | A | AC-ACC-06 |
| TC-AUTH-11 | Eliminação de conta bloqueada (único tutor / único Admin) e permitida depois | A | AC-ACC-05 |
| TC-AUTH-12 | Mudança de fuso recalcula tomas futuras | I | AC-MED-05 |

> **Nota M6 (change control, ver `apps/api/src/modules/medications/README.md`):** TC-AUTH-12 pressupõe um gatilho *imediato* de `users.updateMe` para `medications`, que exigiria `users` → `medications` e fecharia um ciclo (`medications` → `access` → `families` → `users`). Implementado em vez disso: o job diário `medications.generate-doses` relê o fuso efetivo a cada corrida (latência ≤24h). O caso unitário equivalente (`generateDosesJob` recalcula sem duplicar/perder) está em `medications/application/generate-doses-job.test.ts`; a versão *imediata* de TC-AUTH-12 fica pendente de decisão do proprietário.

## 2. Autorização e isolamento (TC-AZ) — **gerados da matriz**
| ID | Caso | Nível |
|---|---|---|
| TC-AZ-MATRIX | Para cada relação (SELF, TUTOR_OF, DEPENDENT_SELF, OTHER, Admin-como-OTHER, PLATFORM_ADMIN) × categoria (5) × ação (ler/criar/editar/eliminar/confirmar) o resultado esperado de `authorization.md` §3 | U + A |
| TC-AZ-ISO | Percorrer **todos** os endpoints com `familyId`: utilizador de outra família ⇒ 404 | A + S |
| TC-AZ-IDOR | Trocar `memberId`/`recordId` por id de outra família ou outro membro (mesmo com família correta) ⇒ 404 | S |
| TC-AZ-SHARE | Partilha por categoria e "toda a família"; retirada com efeito imediato; só leitura | A |
| TC-AZ-ADMIN | Family Admin sem partilha não lê saúde de outro adulto | A |
| TC-AZ-DEP | Dependente com conta: permitido (medicação, consultas, confirmar toma), negado (resto) | A |
| TC-AZ-PLAT | Platform Admin negado em todos os endpoints de saúde; imports do módulo `admin` verificados | A + arquitetura |
| TC-AZ-SUSP | Suspender conta corta acesso em ≤60 s | A |
| TC-AZ-POLICY-CALLED | Rota de negócio sem decisão de policy registada falha o teste | I |

## 3. Família, membros, tutela, convites (TC-FAM)
| ID | Caso | Nível | Liga a |
|---|---|---|---|
| TC-FAM-01 | Criar família ⇒ Admin; limite de 5 famílias | A | AC-FAM-01/02 |
| TC-FAM-02 | Último Admin não sai/perde papel; transferência exige adulto com conta | A | AC-FAM-03 |
| TC-FAM-03 | Eliminar família: recusa com >1 membro; apaga tudo com 1 | A + I | AC-FAM-04 |
| TC-FAM-04 | Constraint: um tutor principal por dependente; sem auto-tutela | I | BR-MEM-06 |
| TC-FAM-05 | Menor ⇒ dependente obrigatório; tutor adulto com conta da mesma família | U + A | AC-MEM-02 |
| TC-FAM-06 | Convite: 7 dias, uso único, e-mail coincide, limite 20 pendentes | A | AC-MEM-03 |
| TC-FAM-07 | Convite ligado a perfil: `BIRTHDATE_MISMATCH` | A | AC-MEM-04 |
| TC-FAM-08 | Sair/remover: pacote gerado antes do apagamento (TAKE e remoção por Admin) | A + I | AC-MEM-06/07 |
| TC-FAM-09 | Maioridade: avisos 30/7/0 dias, fim da tutela, perda de acesso do tutor, partilha mantida | I (relógio) | AC-MEM-08 |
| TC-FAM-10 | Menor sem conta aos 18: BLOCKED, avisos 0/30/60/83, apagado aos 90 | I (relógio) | AC-MEM-09 |
| TC-FAM-11 | Limites: 20 membros, 10 clínicas privadas | A | BR-FAM-07 |

## 4. Registos de saúde (TC-HLT)
| ID | Caso | Nível |
|---|---|---|
| TC-HLT-01 | CRUD de alergia/condição/tipo sanguíneo; auditoria sem versionamento | A |
| TC-HLT-02 | Validações: datas plausíveis, `until ≥ since`, enums | U |
| TC-RX-01 | Receita cria planos e ocorrências (14 dias) | I |
| TC-RX-02 | Receita inválida (sem data, data futura, sem medicamentos) | A |
| TC-RX-03 | Concluir/cancelar/reabrir receita e planos (ST1) | A |
| TC-RX-04 | Eliminar receita apaga planos, tomas e ficheiros | I |
| TC-MED-01 | Geração FIXED_TIMES (dias da semana) e INTERVAL | U |
| TC-MED-02 | **DST:** hora inexistente (março) e repetida (outubro) em Europe/Lisbon | U |
| TC-MED-03 | Janela de toma: PENDING→UNCONFIRMED às 2 h; confirmação tardia até ao fim do dia seguinte; correção até 7 dias; futuro >1 h recusado | U + A |
| TC-MED-04 | Confirmação idempotente; regista quem e quando; D sem conta confirmada por T | A |
| TC-MED-05 | Editar plano só afeta futuro; passado preservado | I |
| TC-MED-06 | Adesão: contagens por estado | I |
| TC-APT-01 | Criar/editar/cancelar/reagendar; lembretes 24 h e 2 h recalculados | I |
| TC-APT-02 | Consulta passada permanece SCHEDULED; pedido de desfecho 24 h depois, uma vez | I |
| TC-APT-03 | Transições de estado válidas e inválidas (ST4) | U |
| TC-CLN-01 | Clínicas privadas/parceiras: visibilidade, arquivo, nome preservado em consultas | A |
| TC-EXM-01 | Exame futuro/passado (ST5); resultados só em COMPLETED; valores numérico/texto (Q9) | A |
| TC-EXM-02 | Valor fora do intervalo informado não gera alerta nem marca | A |
| TC-EXM-03 | Histórico de um parâmetro ordenado por data | A |

> **Nota M7 (change control, mesmo padrão da nota M6 em TC-AUTH-12):** TC-APT-01 (metade "lembretes 24h/2h recalculados") e TC-APT-02 (metade "pedido de desfecho 24h depois") descrevem o scanner de `alerts`, que só existia em M8 (`modules.md` §2: `alerts` depende de `appointments`, nunca o inverso — `plan.md` §4 confirma `FR-ALR` em M8). Implementado em M7: os dados de que `alerts` vai precisar (`scheduledAt`, `status`, `outcomeRequestedAt`) ficam corretos, e nenhum processo deste módulo muda o estado por si só — caso coberto em `appointments/application/appointments.test.ts` ("AC-APT-02: nunca muda de estado por si só"). TC-APT-03 (ST4), TC-CLN-01 e TC-EXM-01/02/03 estão cobertos nos testes de `appointments`/`clinics`/`examinations` (`application/*.test.ts`).
>
> **Nota M8 (concluído):** as metades pendentes de TC-APT-01/02 (geração de lembretes 24h/2h e pedido de desfecho) e TC-ALR-01..08 (abaixo) estão cobertas em `alerts/application/scan-job.test.ts`, `alerts/application/alerts.test.ts`, `alerts/domain/*.test.ts`, `notifications/application/*.test.ts` e `notifications/domain/*.test.ts`.

## 5. Documentos (TC-DOC)
| ID | Caso | Nível |
|---|---|---|
| TC-DOC-01 | Upload válido ⇒ PENDING ⇒ CLEAN ⇒ download | I + A |
| TC-DOC-02 | EICAR ⇒ eliminado, recusado, auditado | I |
| TC-DOC-03 | Extensão falsa/magic bytes, >10 MB, 6.º ficheiro, quota 100 MB | A |
| TC-DOC-04 | Download exige permissão da categoria; auditado; cabeçalhos de cache | A + S |
| TC-DOC-05 | Download de documento PENDING ⇒ `DOCUMENT_NOT_AVAILABLE` | A |
| TC-DOC-06 | Outbox: apagar recurso enfileira e apaga objeto; retry se storage falha | I |
| TC-DOC-07 | Checksum guardado e verificado | I |

## 6. Alertas e notificações (TC-ALR)
| ID | Caso | Nível |
|---|---|---|
| TC-ALR-01 | Scanner gera alerta de toma no horário; repetição única aos 15 min; sem repetição se confirmada | I (relógio) |
| TC-ALR-02 | Idempotência: scanner N vezes ⇒ sem duplicados (`dedupeKey`) | I |
| TC-ALR-03 | Destinatários: titular; D sem conta ⇒ tutores; D com conta ⇒ D e tutores | I |
| TC-ALR-04 | Texto genérico (sem nomes, medicamentos, horas) em push e e-mail | A + S |
| TC-ALR-05 | Preferências: canais e tipos; falha de um canal não impede o outro | I |
| TC-ALR-06 | Retry com backoff (5 tentativas); SKIPPED para conta suspensa/sem canal | I |
| TC-ALR-07 | Lembretes de consulta 24 h/2 h e exame 24 h; recálculo ao editar/cancelar | I |
| TC-ALR-08 | Subscrições push inválidas removidas | I |

## 7. Relatórios e exportação (TC-RPT)
| ID | Caso | Nível |
|---|---|---|
| TC-RPT-01 | Relatório individual respeita partilha por secção (omite sem permissão) | A |
| TC-RPT-02 | Visão familiar respeita D13; Admin sem privilégio | A |
| TC-RPT-03 | Período por defeito 12 meses; >5 anos recusado; paginação | A |
| TC-RPT-04 | Exportação (titular, tutor pelo dependente, menor recusado) com JSON + documentos | I + A |

## 8. Auditoria, RGPD, operação (TC-AUD/OPS)
| ID | Caso | Nível |
|---|---|---|
| TC-AUD-01 | Ações sensíveis produzem registo completo (sem dados de saúde no metadata) | I |
| TC-AUD-02 | Anonimização ao eliminar User; purga a 24 meses | I (relógio) |
| TC-AUD-03 | Papel de BD da aplicação não consegue UPDATE/DELETE em `audit_logs` | I |
| TC-LOG-01 | Dados canário não aparecem em logs, erros nem notificações | S |
| TC-DEL-01 | Hard delete (User/família/membro): BD + storage + auditoria anonimizada | I |
| TC-ARCH-01 | Regras de dependência de módulos (`admin` sem imports de saúde, sem ciclos) | U (arquitetura) |
| TC-CON-01 | OpenAPI do código = repositório; respostas validam o schema | A |
| TC-MIG-01 | Sem *drift* entre migrações e esquema; constraints críticas violáveis só com erro | I |
| TC-OPS-01 | Health e readiness; degradação com Redis/BD em baixo | A |

## 9. Segurança adicional (TC-SEC)
Cabeçalhos de segurança · CORS restrito · rejeição de campos desconhecidos (whitelist) · limites de corpo · injeção em texto livre · enumeração (registo/recuperação/convites) · SSRF em endpoints push · refresh sem cabeçalho CSRF recusado · cookie com flags corretas.

## 10. Carga e resiliência (TC-PERF / TC-RES)
| ID | Caso | Alvo |
|---|---|---|
| TC-PERF-01 | 1 000 famílias / 5 000 users: leituras p95 ≤ 500 ms; escritas p95 ≤ 1 s | NFR-PERF-01/02 |
| TC-PERF-02 | Pico de lembretes às horas redondas: atraso ≤ 1 min | NFR-PERF-03 |
| TC-PERF-03 | Scanner com 100 000 ocorrências futuras: tempo por execução ≪ 1 min | ADR-009 |
| TC-RES-01 | Perda do Redis: filas reconstruídas a partir da BD sem perder nem duplicar lembretes | ADR-004 |
| TC-RES-02 | Falha do SMTP/Push: retry e entrega posterior | ST6 |
| TC-RES-03 | Restauro de backup (RPO ≤ 24 h, RTO ≤ 8 h) | N10 |
