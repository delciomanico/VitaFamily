# Vita Family — Roadmap

> v0.1 (2026-10-04). **[PROPOSTO]** Sem datas: não foram definidas capacidade nem prazos (**TBD**).

## Fases de documentação (ordem obrigatória do prompt)
1 Discovery ✅ · 2 MVP (em revisão) · 3 Requisitos funcionais · 4 Não funcionais · 5 Atores e permissões · 6 Casos de uso · 7 Regras de negócio · 8 Modelo de domínio · 9 Entidades e relações · 10 Estados e fluxos · 11 Arquitetura · 12 Base de dados · 13 API contract · 14 Segurança · 15 Testes · 16 Plano de implementação · 17 Implementação.

## Evolução do produto (candidatos pós-MVP, não aprovados)
| Horizonte | Candidatos |
|---|---|
| **Pós-MVP 1** | Alertas simples por resultados com intervalo informado (D11-B), exportação PDF, SMS. |
| **Pós-MVP 2** | Clínicas com login; partilha consentida família↔clínica; consultas REQUESTED/CONFIRMED. |
| **Pós-MVP 3** | App nativa, catálogos de medicamentos, interações medicamentosas (com validação clínica). |
| **Longe** | Integrações com hospitais/farmácias, e funcionalidades listadas como fora do MVP no prompt. |

Qualquer item acima só entra no âmbito por change control.

> OCR de documentos saiu desta lista por change control de 2026-10-17 (decisão do proprietário): entrou no MVP como leitura no próprio dispositivo (sem terceiros), só como pré-preenchimento de melhor esforço em Receitas e Exames — o utilizador revê e confirma sempre antes de guardar. Ver `scope.md` §2/§3.

> "Resumo com IA" (ADR-022, change control de 2026-10-17, decisão do proprietário): parte da exclusão geral de IA/análise médica avançada acima passa a ter uma exceção estrita — contextualização de tendências nos dados já existentes, sem ação clínica/diagnóstico, via API de um fornecedor externo (Anthropic/OpenAI, a decidir), opt-in, com gate de lançamento ligado à AIPD e a um DPA com o fornecedor. Ver `scope.md` §1/§2/§3, `business-rules.md` BR-RPT-03..09.

## Pivô 2026-11-16 (ADR-037) — marcos do mercado de profissionais (substituem A–F como foco)
**MK0** preparação (interruptor de seguradoras, parecer jurídico, contratos) → **MK1** profissionais + validação → **MK2** descoberta + chat → **MK3** marcação + comprovativo + avaliações → **MK4** partilha com prazo / visualização única → lançamento Angola (gate: AIPD/DPA + parecer jurídico). Detalhe, dependências, donos e critérios em `marketplace-profissionais.md` §10. **Adiados (não apagados):** marcos A–C e Empresa fase 2 (seguradoras/autorizações/despesas; ADR-029..036), retomáveis por change control; D–F continuam bloqueados. Comissão/assinatura do mercado: depois do MVP, ADR próprio.

## Marcos propostos após M15 (2026-11-14) — PROPOSTOS, não aprovados; **ADIADOS pelo pivô de 2026-11-16**
Detalhe em `11-implementation/plan.md` §4 e `business-model.md`: **A** consolidar Fase A · **B** autorizações (S4) · **C** despesas (S5) · **Empresa fase 2** (portal leve, ADR-031) · **D** segurança medicamentosa · **E** assistente de sintomas · **F** wearables + incentivos. D, E e F estão **bloqueados** por conflitos com BR-HLT-03/BR-RPT-03/ADR-022 e com o princípio "dados do app não alimentam prémio/cobertura" (business-model.md §7). Não aprovados; só entram no âmbito por change control.
