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
