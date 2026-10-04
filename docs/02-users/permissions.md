# Vita Family — Permissões (Fase 5)

> Estado: **v0.2 — P1–P8 decididas (secção 6, delegadas ao assistente)**
> Legenda: ✅ permitido · ❌ negado · 🔗 só se o titular partilhou a categoria · ❓ depende de decisão pendente.
> Ações: **V** ver · **C** criar · **E** editar · **D** eliminar.
> Regra geral: **negar por defeito**; qualquer ação não prevista aqui é negada. A verificação é sempre no backend.

## 1. Categorias de dados (base da partilha, R5)

Decidido em P1:

| Categoria | Conteúdo |
|---|---|
| **C1 Identificação** | Nome e data de nascimento — visíveis a toda a família, **não é partilha opcional** (BR-PRV-10) |
| **C2 Alergias e tipo sanguíneo** | Alergias registadas e tipo sanguíneo |
| **C3 Condições e histórico médico** | Condições, histórico |
| **C4 Medicação** | Receitas, medicamentos, planos e histórico de tomas |
| **C5 Consultas** | Consultas |
| **C6 Exames** | Exames, resultados, documentos associados |

Os documentos seguem a categoria do recurso a que pertencem (receita → C4, exame → C6).

## 2. Matriz — dados de saúde de um **adulto com conta** (titular = ele próprio)

| Ator | C1 | C2 | C3 | C4 | C5 | C6 |
|---|---|---|---|---|---|---|
| **SELF** | V C E D | V C E D | V C E D | V C E D | V C E D | V C E D |
| **Outro membro (incl. Family Admin)** | 🔗 V | 🔗 V | 🔗 V | 🔗 V | 🔗 V | 🔗 V |
| **Platform Admin** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

- A partilha dá **só leitura**; não há delegação de escrita no MVP (P6).
- Family Admin **não** tem acesso privilegiado a dados de saúde (D13-C).

## 3. Matriz — dados de saúde de um **dependente**

| Ator | C1 | C2 | C3 | C4 | C5 | C6 |
|---|---|---|---|---|---|---|
| **Tutor** | V C E D | V C E D | V C E D | V C E D | V C E D | V C E D |
| **Dependente com conta** | V | ❌ | ❌ | V + confirmar toma | V | ❌ |
| **Outro membro (incl. Family Admin não tutor)** | 🔗 V | 🔗 V | 🔗 V | 🔗 V | 🔗 V | 🔗 V |
| **Platform Admin** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

- Quem decide a partilha dos dados de um dependente com outros membros: o tutor (P3).
- O dependente com conta **não edita** dados clínicos (N2).

## 4. Matriz — estrutura da família

| Ação | Family Admin | Family Member | Tutor (não Admin) | Dependente c/ conta | Platform Admin |
|---|---|---|---|---|---|
| Criar família | ✅ (qualquer User autenticado) | ✅ | ✅ | ❌ | ❌ |
| Ver membros e papéis | ✅ | ✅ | ✅ | ✅ (só nomes) | ❌ |
| Editar nome da família | ✅ | ❌ | ❌ | ❌ | ❌ |
| Convidar membro | ✅ | ❌ | ❌ | ❌ | ❌ |
| Criar perfil de membro sem conta | ✅ | ❌ | ❌ | ❌ | ❌ |
| Remover membro | ✅ (dependência de R4: dados) | ❌ | ❌ | ❌ | ❌ |
| Atribuir/alterar Family Admin | ✅ | ❌ | ❌ | ❌ | ❌ |
| Atribuir/remover tutor | ✅ | ❌ | ❌ | ❌ | ❌ |
| Sair da família | ✅ (se não for o último Admin) | ✅ | ✅ (deixa de ser tutor; exige substituto, P8) | ❌ (P2) | ❌ |
| Eliminar família | ✅ só se for o único membro (R2) | ❌ | ❌ | ❌ | ❌ |

## 5. Outras permissões

| Recurso | Regra |
|---|---|
| **Conta própria** | Cada User edita o seu perfil, fuso horário, preferências de notificação, e elimina a sua conta (FR-AUTH-05). |
| **Partilha (categorias)** | Só o titular adulto decide; tutor decide pelo dependente. |
| **Exportação de dados (FR-PRIV-05)** | O User exporta os seus; o tutor exporta os do dependente (P2). |
| **Clínicas** | Platform Admin: cria/edita/arquiva parceiras. Users: criam/editam/apagam entradas privadas **da sua família**; todos escolhem parceiras ao marcar consulta (R8). |
| **Documentos** | Descarregar exige permissão de **ver** a categoria do recurso; cada download é auditado (FR-DOC-03). |
| **Alertas** | Destinatários: o titular; para dependentes, os tutores e o próprio dependente se tiver conta (FR-ALR-08). Cada User gere apenas as suas preferências. |
| **Relatórios** | Só incluem o que o pedinte pode ver (FR-RPT-03). A visão familiar mostra a cada utilizador **apenas as categorias partilhadas com ele**, mais os seus dados e os dos seus dependentes. |
| **Auditoria (leitura de logs)** | Sem endpoint de leitura no MVP (P7). |

## 6. DECISÕES DESTA FASE (P1–P8)

> **Delegadas pelo proprietário ao assistente em 2026-10-04** ("responde tu com o mais correto"). Foi adotada a recomendação em todas. Continuam sujeitas a revisão por change control; qualquer uma pode ser contestada.

| ID | Decisão | Escolha | Consequência registada |
|---|---|---|---|
| P1 | Categorias de partilha | **As 6 categorias C1–C6.** Por defeito é partilhado **apenas C1** (nome e data de nascimento); o resto é privado. | Aplica-se a adultos e, via tutor, a dependentes. |
| P2 | Consentimento e autonomia do dependente | **(a)** o tutor tem de autorizar sempre a criação de conta de um dependente menor; **(b)** um menor nunca sai da família nem exporta dados sozinho: age via tutor. | Dependente menor com conta: não pode sair da família (❌); o tutor exporta os dados do dependente. |
| P3 | Partilha dos dados do dependente | **Só o tutor decide, por categoria.** | Sem partilha total por defeito. |
| P4 | Dependente menor faz 18 anos | **C** — a tutela termina nesse dia; passa a SELF; o tutor perde acesso aos dados e o adulto decide o que partilha. | Aplica-se a menores; adultos dependentes (N3) mantêm a tutela. A partilha anterior com outros membros mantém-se até o titular a alterar. Notificar o tutor e o jovem antes (antecedência: Fase 7). |
| P5 | Dependente com conta vê membros | **Sim, só nomes**, sem dados de saúde. | |
| P6 | Escrita por outros membros | **Sem delegação no MVP.** Só o titular e o tutor escrevem. | A partilha é só leitura. Delegação possível por change control. |
| P7 | Auditoria acessível ao titular | **Não no MVP** (só logs internos). | Evolução RGPD candidata: o titular ver quem acedeu aos seus dados. |
| P8 | Perda do único tutor | **Bloquear:** o tutor não pode apagar a conta nem sair enquanto for o único tutor de um dependente; tem de atribuir outro (ou o Family Admin atribui). | O Admin atribui tutor apenas a outro adulto da família. A eliminação de conta fica bloqueada com mensagem clara. |

### Células da matriz resolvidas
- **Dependente com conta (secção 3):** C1 ✅ V · C2 ❌ · C3 ❌ · C4 V + confirmar toma · C5 V · C6 ❌ (N2: só medicamentos e consultas; o que não está listado é negado).
- **Outros membros sobre dependente:** 🔗 V segundo o que o tutor partilhou.
- **Estrutura da família (secção 4):** atribuir/remover tutor ✅ Family Admin; dependente com conta não sai da família.

### Notas derivadas
- Acrescenta-se a regra: **dependente que atinge 18 anos** gera um evento que dispara a mudança de P4 (Fase 7 define o processo e os avisos).
- Acrescenta-se a regra: **o Family Admin pode atribuir tutor, mas não vê dados do dependente** por isso (N1).

---

*Fim da Fase 5 (v0.2). Atores, papéis e permissões fechados no âmbito do MVP. Próxima: Fase 6 — Casos de uso.*
