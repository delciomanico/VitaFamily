# ADR-016 — Limites práticos da Clean Architecture por módulo (quando criar porta, quando não)

**Estado:** Aceite — decisão do proprietário (2026-10-08). Esclarece/estreita ADR-014/ADR-015; não as substitui (a arquitetura em camadas e a independência de ferramentas mantêm-se como regra). Complementa `conventions.md` §3.2, que já continha a regra mas sem exemplos concretos.

## Contexto
ADR-014/ADR-015 exigem, por módulo, a separação `domain → application → infrastructure → interface` com portas substituíveis. Revendo o código de M1 (`auth`, `users`, `audit`), o proprietário notou que a estrutura, embora internamente consistente, é difícil de seguir para quem não a desenhou (um júnior a abrir `router.ts` → `refresh.ts` → `ports.ts` → `repo.ts` não sabe por onde começar sem já ter o mapa do padrão na cabeça). O risco identificado não é a arquitetura em si, mas aplicá-la como obrigação uniforme mesmo onde não há nenhuma ferramenta externa a substituir — o que gera camadas vazias e indireção sem benefício, e agrava o custo de leitura sem o compensar com substituibilidade real.

`conventions.md` §3.2 já dizia "não criar portas por defeito", mas sem critério explícito nem exemplos — na prática isso não impediu a ambiguidade. Este ADR torna o critério explícito e acrescenta uma mitigação para o custo de leitura (README por módulo), em vez de recuar na arquitetura em camadas.

## Decisão
**Critério para criar uma porta (interface em `application`, implementada em `infrastructure`):**
Só quando pelo menos uma destas condições se verifica:
1. Há uma ferramenta externa real e plausivelmente substituível (BD/Kysely, fila/pg-boss, storage/MinIO, e-mail/Nodemailer, push, antivírus, framework HTTP) — é exatamente a tabela do ADR-014.
2. Há ou vai haver um segundo consumidor/implementação (ex.: `Mailer` tem `SmtpMailer` e `FakeMailer` nos testes).
3. É preciso injetar para testar sem I/O real (ex.: `Clock`, repositórios em testes de caso de uso).

**Quando NÃO criar porta (indireção sem substituição real):**
- Bibliotecas de computação pura, sem I/O, que não vamos trocar (`argon2`, `jose`, `node:crypto`) — chamam-se diretamente do `domain`. A regra que já protege isto é "sem bibliotecas de I/O em `domain`/`application`" (conventions.md §3.9, `tests/architecture-rules.ts`); isso já é suficiente, não precisam de um `Port` só para parecerem substituíveis.
- Casos de uso triviais de uma única operação sem chamada a `infrastructure` (ex.: `deleteMe` ainda sem efeito em M1) — não criar `infrastructure/`/`interface` vazias só para manter a forma.
- Uma camada sem conteúdo real num módulo específico pode ficar de fora da árvore de pastas (ex.: um módulo sem adaptador próprio não precisa de pasta `infrastructure/` vazia). A estrutura de 4 camadas em ADR-015 é o **máximo** disponível por módulo, não um mínimo obrigatório em todos.

**Mitigação do custo de leitura (em vez de recuar na arquitetura):**
Cada módulo com código implementado tem um `src/modules/<m>/README.md` curto (não mais de ~40 linhas) com: (1) o que o módulo faz em 1-2 frases; (2) o mapa de um pedido típico, ficheiro a ficheiro (ex.: `POST /auth/refresh → interface/router.ts → application/refresh.ts → application/ports.ts (o que precisa) → infrastructure/repo.ts (como é feito)`); (3) que portas existem e porquê (qual das 3 condições acima justifica cada uma). Isto não é imposto pelo teste de arquitetura (é documentação, não uma regra mecânica) — é parte da definição de "feito" de um módulo, verificada por revisão (`vita-architect` ou o próprio dono do módulo).

## Alternativas
Recuar para uma estrutura mais plana (sem camadas) — rejeitado: perde-se a substituibilidade que motivou ADR-014, e o ganho de legibilidade para um júnior é menor do que o de um README de orientação. Impor a estrutura completa de 4 camadas em todos os módulos sem excepção (status quo) — rejeitado: gera pastas vazias e portas sem segundo consumidor, custo sem benefício. Ferramenta automática de "mapa de módulo" gerada a partir do grafo de imports — adiado: complexidade desproporcional ao problema (um README escrito à mão resolve o mesmo problema com uma fração do esforço).

## Justificação
O objetivo original ("independência de ferramentas externas, substituível sempre que possível") é sobre fronteiras que *realmente* podem mudar — não sobre uniformidade de pastas. Tornar o critério explícito com exemplos evita que cada agente/módulo decida isto de forma diferente (o que criaria inconsistência pior do que a regra uniforme que está a ser ajustada). O README por módulo ataca o problema que foi levantado — legibilidade para quem não desenhou a estrutura — sem sacrificar a substituibilidade onde ela importa.

## Consequências
- `conventions.md` §1 e §3.2 atualizados com os critérios e exemplos acima, e com a exigência do `README.md` por módulo.
- Não há alteração ao teste de arquitetura (`tests/architecture-rules.ts`): já só impõe direção de imports e proibição de I/O em `domain`/`application`, nunca exigiu a presença de todas as camadas nem a existência de portas — por isso este ADR é compatível com o código de M0/M1 tal como está, sem necessidade de reescrever `ports.ts` de `auth`/`users` (já seguem o critério: todas as portas existentes correspondem a BD/e-mail/relógio/auditoria, nenhuma é de computação pura).
- Trabalho imediato: criar `README.md` em `modules/audit`, `modules/auth`, `modules/users` (os módulos já implementados). Módulos futuros (M2+) seguem o mesmo critério desde o início.
- Agentes (`.claude/agents/*.md`) não precisam de alteração: já citam `conventions.md` como fonte, que é onde o critério fica detalhado.
