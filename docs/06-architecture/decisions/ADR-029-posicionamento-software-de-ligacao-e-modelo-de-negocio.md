# ADR-029 — Posicionamento: software de ligação (não TPA) e modelo de negócio

**Estado:** **Proposto — aguarda aprovação do proprietário** (change control **D25**, proposto em 2026-11-14). Em termos de **direção de produto**, o proprietário já decidiu o posicionamento (conversa de 2026-11-14); este ADR formaliza-o e lista o que dele decorre. Os preços e o modelo comercial são **hipótese não validada**. Adenda a ADR-021/ADR-025; **não substitui** nenhum ADR. Conflitos com regras existentes estão em `00-product/business-model.md` §7 e **não** são resolvidos aqui.

## Contexto
O Vita nasceu como app de saúde familiar (`vision.md`) e ganhou portais de clínica (ADR-020/026) e de seguradora (ADR-021/025). Falta fixar **o que o Vita é** perante o mercado (e perante o regulador) e **como se financia**, porque isso condiciona partes, acessos, faturação e riscos legais.

## Decisão (proposta)
1. **Posicionamento:** o Vita é **software de ligação** entre famílias, prestadores, seguradoras e empresas. **Não é um TPA** (administrador de terceiros). A **seguradora continua a pagar** e a decidir; o Vita **processa autorizações e despesas** (fluxos, regras configuradas pela seguradora, rasto) mas não detém risco, não paga prestadores em nome da seguradora e não gere fundos. Tornar-se TPA só **mais tarde**, com **parceiro licenciado** (novo ADR e parecer jurídico).
2. **Partes e acessos:** família, prestador, seguradora, empresa (e backoffice Vita) com o modelo de acessos de `00-product/business-model.md` §2–§3. Princípio estrutural: **a família é soberana dos dados clínicos**; cada outra parte vê o **mínimo necessário** à sua função.
3. **Modelo comercial (HIPÓTESE, preços por validar):** famílias **grátis**; seguradoras e empresas pagam **por vida ativa/mês + taxa por transação** (autorização/despesa); prestadores **grátis** com **nível pago opcional** (agenda avançada, visibilidade, relatórios). Sem preços nesta documentação até validação com clientes.
4. **Prestador sem seguradora** como porta de entrada: ver ADR-030.
5. **Empresa** como quarta parte: ver ADR-031.
6. **Trajetória (proposta, ver `plan.md` §4 "Propostos pós-M15"):** consolidar Fase A → autorizações → despesas → portal da empresa → segurança medicamentosa → assistente de sintomas → wearables+incentivos. Os três últimos **dependem de decisões de conflito** (§Conflitos) e estão **bloqueados** até lá.

## Consequências
- **Faturação/medição**: o produto precisa de contar vidas ativas e transações por seguradora/empresa. Hoje não existe módulo de faturação nem métricas de uso por tenant nos docs: **novo âmbito** (só medição; a faturação formal pode ser externa). Decisão em aberto: quando e como.
- **Regulatório (Angola)**: risco de o Vita ser enquadrado como mediador de seguros, TPA ou entidade a tratar dados de saúde por conta de terceiros; **a validar com jurista** (ARSEG, Lei 22/11 de proteção de dados). Sem parecer, o posicionamento é uma intenção comercial, não uma garantia. Pendência já registada em `README.md` (Lei 22/11, alojamento).
- **Contradição com a visão**: `vision.md` ("O que NÃO é": marketplace/pagamentos; mercado inicial Portugal/UE) e `scope.md` precisam de revisão se aprovado.
- **Sem alteração a código, contrato ou BD** por este ADR.

## Decisão do proprietário de 2026-11-14 (Q-C1) — copagamento
**DECIDIDO:** o copagamento é pago no **balcão do prestador**; o Vita **só calcula e mostra** (antes, como estimativa, e depois, valor final) e **não processa pagamentos**, mantendo-se software e não TPA. Alternativa rejeitada: pagamento do copagamento dentro do Vita. Este ADR continua **Proposto** (aprovação formal pendente); a decisão passa a ser pressuposto firme do fluxo (`00-product/process-flows.md` §10). Alteração proposta a BR-SEG-06/08 em `process-flows.md` §11a, pendente.

## Conflitos identificados (a decidir pelo proprietário)
Ver `00-product/business-model.md` §7 (C1–C10). Os de maior impacto: princípio "dados do app não alimentam prémio/cobertura" (`privacy.md`, `insurer-phase-a.md` §3.4) versus incentivos/wearables; BR-SEG-18/BR-INS-08 versus "mínimo do ato autorizado"; BR-HLT-03/BR-RPT-03/ADR-022 versus segurança medicamentosa e assistente de sintomas.

## Alternativas consideradas
| Alternativa | Porque não (proposta) |
|---|---|
| Ser TPA desde já | Exige licenciamento e capital/risco operacional que o Vita não tem; adiado para parceiro licenciado. |
| Famílias a pagar | Reduz adoção; o valor para a seguradora/empresa depende de base de famílias. |
| Cobrar só por assento/portal | Não acompanha o valor (vidas e transações); hipótese menos alinhada com o proprietário. |

## Pendências para o proprietário
Aprovar/recusar o ADR; escolher o momento de abrir o módulo de medição; mandatar o parecer jurídico (Angola).
