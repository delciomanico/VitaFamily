# ADR-031 — Empresa (tomador de seguro de grupo) e portal da empresa

> **Nota (pivô 2026-11-16, ADR-037):** ADR-029/030/031 e o âmbito de seguradoras (ADR-021/025, marco B) ficam **adiados**; ver ADR-037.

**Estado:** **Proposto — aguarda aprovação do proprietário** (change control **D27**, proposto em 2026-11-14). Adenda a ADR-021/ADR-025 (que já têm `insurer_companies`, geridas pela seguradora). Não substitui nenhum ADR. Quarto ator parceiro (mirror de ADR-020/021).

> **Estado (atualizado 2026-11-14, fonte: ordem do proprietário): ACEITE COM ÂMBITO DE CONSTRUÇÃO LIMITADO.** O proprietário ordenou "pode avançar para construção" (marco B, `11-implementation/marco-b-construcao.md`). A aceitação cobre **só** o que a construção das fatias 0–6 do marco B exige; tudo o que está listado como pendente neste ADR e em `marco-b-construcao.md` §1 **continua Proposto/não aceite** e aplica-se o **default conservador** aí documentado. Onde o texto abaixo diz "Proposto", lê-se "aceite dentro deste âmbito".
> Âmbito aceite: **nenhum de construção no marco B** (direção reconhecida). Empresa fica na fase 2; C1/C10, k mínimo e entidade por decidir.

## Contexto
`insurer_companies` (ADR-025) representa a empresa **dentro de cada seguradora** (Fase A: a seguradora gere empresas e colaboradores em Beneficiários → empresas). O proprietário quer, mais tarde, um **portal próprio leve** para a empresa.

## Decisão (proposta)
1. **Fase 1 (já existente):** a **seguradora** gere as empresas e os seus colaboradores/dependentes (importação CSV/XLSX, BR-SEG-17). Sem conta de empresa.
2. **Fase 2 — portal da empresa (leve):** adesão e saída de colaboradores, dependentes, e **indicadores agregados e anónimos**. Sem prestadores, sem autorizações individuais, sem sinistros individuais.
3. **Entidade:** `Employer`/Empresa passa a poder existir como entidade própria (NIF único) ligada a uma ou mais seguradoras por **contrato/apólice de grupo**; em Fase 1 mantém-se `insurer_companies`. Decisão pendente: entidade única global ou uma por seguradora (recomendada: global, ligada por apólice de grupo).
4. **Ator novo:** `EmployerAccount` (contas e sessões separadas, claims/`ActorInfo` próprios, rotas `/employer-portal/*`), como ADR-020/021. Papéis propostos: `EMPLOYER_ADMIN`, `EMPLOYER_HR`. Teste de arquitetura equivalente.
5. **Agregação anónima:** custo e utilização só em agregados com **limiar mínimo de k pessoas** (valor proposto k = 10, **a validar**); abaixo de k não se mostra o indicador (nem por diferenças entre períodos); **nunca** dados clínicos individuais, diagnósticos ou identificação por indicador. A fonte é a **seguradora** (autorizações/despesas); **nunca** dados do app (ver conflito C1).
6. **Colaborador:** tem **conta Vita pessoal**; o **vínculo à empresa é revogável** pelo colaborador; **ao sair, o histórico fica com ele** (portabilidade): a empresa perde acesso ao vínculo e ao agregado que o inclua a partir da data de saída, o histórico pessoal (cartão, autorizações, despesas) permanece na conta da família; a seguradora mantém os registos contratuais próprios.
7. **Adesão/saída** (empresa) não depende do consentimento do colaborador para efeitos contratuais, mas a **ligação de dados Vita** (BR-SEG-20: código de reclamação + consentimento) continua a ser do colaborador.

## Consequências
- Novo módulo `employer` e portal; migração com `employers`, `employer_accounts`, vínculos; teste de privacidade do limiar k; auditoria nova (`actor_type=EMPLOYER_ACCOUNT`).
- **RGPD/Lei 22/11:** a empresa trata identidade de colaboradores como empregador; o Vita é subcontratante da seguradora/empresa neste fluxo — **papéis a validar com jurista**.
- **Risco de reidentificação** em empresas pequenas: k alto, supressão complementar e política de exceção.
- Medição comercial (vida ativa/mês) assenta nos vínculos (ADR-029).

## Alternativas consideradas
| Alternativa | Porque não (proposta) |
|---|---|
| Empresa sem portal (só seguradora) | Mantém-se na Fase 1; limita valor para a empresa na Fase 2. |
| Empresa vê colaboradores individualmente | Viola minimização; risco de discriminação laboral. |

## Nota de 2026-11-14
As decisões Q-U1/Q-C1/Q-P1/Q-S1 (`00-product/process-flows.md` §10) não alteram este ADR: a Empresa continua fora do fluxo individual; os indicadores agregados poderão usar `Process` (contagens), sempre com k mínimo.

## Pendências para o proprietário
Aprovar; k mínimo; entidade global vs por seguradora; quem paga a empresa quando há várias seguradoras; âmbito exato dos indicadores.
