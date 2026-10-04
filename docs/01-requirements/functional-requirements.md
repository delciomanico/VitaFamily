# Vita Family — Requisitos Funcionais (Fase 3)

> Estado: **v0.2 — R1–R10 respondidas (secção 14); R11 resolvido na Fase 8**
> Base: `scope.md` v0.2 e `discovery.md` v0.2. Nada aqui acrescenta funcionalidade fora do âmbito aprovado.
> Formato: ID · requisito · origem. Linguagem: "o sistema deve…".
> **Permissões detalhadas (quem pode o quê) ficam na Fase 5**; aqui só se indicam restrições já decididas.
> Prioridade: todos **MUST** do MVP, salvo indicação. `[NEEDS DECISION]` = depende da secção 14.

---

## 1. Conta e acesso (AUTH)

| ID | Requisito | Origem |
|---|---|---|
| FR-AUTH-01 | O sistema deve permitir registar um User com e-mail e palavra-passe. | scope §2 |
| FR-AUTH-02 | O sistema deve permitir login e logout. | scope §2 |
| FR-AUTH-03 | O sistema deve permitir recuperar a conta por e-mail. | scope §2 |
| FR-AUTH-04 | O sistema deve guardar um fuso horário por User, alterável pelo próprio. | M3 |
| FR-AUTH-05 | O sistema deve permitir ao User eliminar a sua conta, removendo definitivamente os seus dados (ver FR-PRIV-03). | D15 |
| FR-AUTH-06 | Verificação do e-mail no registo (decidido em R1). | — |

Detalhes de sessão, tokens e política de palavras-passe: Fase 14.

## 2. Famílias (FAM)

| ID | Requisito | Origem |
|---|---|---|
| FR-FAM-01 | Um User autenticado deve poder criar uma família e tornar-se Family Admin dessa família. | prompt §21 |
| FR-FAM-02 | Um User deve poder pertencer a várias famílias; cada pedido da API opera no contexto de uma família. | D2 |
| FR-FAM-03 | Uma família deve ter pelo menos um Family Admin. | discovery §13 |
| FR-FAM-04 | O sistema deve permitir editar o nome da família e eliminá-la (hard delete de todos os seus dados). (decidido em R2) | D15 |
| FR-FAM-05 | Os dados de uma família devem estar isolados de todas as outras. | prompt §16 |

## 3. Membros, dependentes e tutela (MEM)

| ID | Requisito | Origem |
|---|---|---|
| FR-MEM-01 | O sistema deve distinguir User (conta) de FamilyMember (pessoa na família). | D1 |
| FR-MEM-02 | O Family Admin deve poder criar diretamente um perfil de membro sem conta. | D14, D1 |
| FR-MEM-03 | O Family Admin deve poder convidar uma pessoa por e-mail ou link; o convite expira (decidido em R3) e é aceite pelo convidado. | D14 |
| FR-MEM-04 | Ao aceitar um convite, a conta deve ficar ligada a um FamilyMember (novo ou perfil existente sem conta). | D1, D14 |
| FR-MEM-05 | Cada FamilyMember deve ter data de nascimento; menor = <18 anos. | M1 |
| FR-MEM-06 | Um dependente (menor ou adulto) deve ter pelo menos um tutor/responsável, que é um FamilyMember da mesma família. | N1, N3 |
| FR-MEM-07 | O tutor deve poder editar o perfil de saúde do dependente. | M6 |
| FR-MEM-08 | Um dependente pode ter conta de acesso limitado: vê os seus medicamentos e consultas e confirma tomas; não edita dados clínicos. | N2, M4 |
| FR-MEM-09 | O Family Admin deve poder remover um membro; o que acontece aos seus dados (decidido em R4). | — |
| FR-MEM-10 | Um membro adulto deve poder sair de uma família. | — (derivado de D2; confirmar R4) |

## 4. Privacidade familiar (PRIV)

| ID | Requisito | Origem |
|---|---|---|
| FR-PRIV-01 | Cada membro adulto controla que dados seus os outros membros veem. Modelo de partilha: (decidido em R5). | D13 |
| FR-PRIV-02 | Os dados de dependentes são geridos pelos seus tutores. | D13, M6 |
| FR-PRIV-03 | Ao eliminar conta/família/dependente, os dados e documentos são removidos definitivamente; os logs de auditoria são anonimizados. | D15 |
| FR-PRIV-05 | O utilizador deve poder exportar os seus dados em formato JSON (N7). | N7, RGPD |
| FR-PRIV-04 | Visibilidade do tutor sobre dependente com conta e sobre adulto dependente: (resolvido: P2/P4 e N2/N3 — o tutor gere todos os dados do dependente; o dependente com conta tem acesso limitado; ao fazer 18 anos a tutela do menor termina). | N2, N3 |

## 5. Perfil de saúde (HP)

| ID | Requisito | Origem |
|---|---|---|
| FR-HP-01 | O sistema deve guardar por FamilyMember: tipo sanguíneo, alergias, condições de saúde e histórico médico. | prompt §6 |
| FR-HP-02 | Alergias e condições são registos individuais (nome, observações, datas relevantes) com campos simples, sem catálogos. | D8 |
| FR-HP-03 | Deve ser possível adicionar, editar e remover cada registo. | — |
| FR-HP-04 | O sistema deve manter o histórico de alterações dos registos de saúde (decidido em R6). | — |

## 6. Receitas (RX)

| ID | Requisito | Origem |
|---|---|---|
| FR-RX-01 | O sistema deve permitir registar manualmente uma receita para um FamilyMember. | scope §2 |
| FR-RX-02 | Uma receita tem 1+ medicamentos, cada um com nome (texto livre), dosagem, frequência, duração e observações. | D8 |
| FR-RX-03 | Uma receita pode ter um documento anexo (PDF/JPG/PNG, máx. 10 MB). | M5 |
| FR-RX-04 | A receita tem um estado simples: ATIVA, CONCLUÍDA, CANCELADA (a confirmar na Fase 10). | D9 |
| FR-RX-05 | Ao registar os medicamentos de uma receita, o sistema deve criar automaticamente o respetivo plano de toma, editável. | M2 |
| FR-RX-06 | Médico e data de emissão são registados (decidido em R7). | — |

## 7. Medicamentos e tomas (MED)

| ID | Requisito | Origem |
|---|---|---|
| FR-MED-01 | O sistema deve listar os medicamentos ativos de um membro, com horários e duração. | scope §2 |
| FR-MED-02 | O sistema deve permitir criar planos de toma sem receita (medicamento avulso). (decidido em R7) | — |
| FR-MED-03 | Cada plano de toma gera ocorrências de toma nos horários definidos, no fuso horário do destinatário do lembrete. | M3 |
| FR-MED-04 | O utilizador (ou tutor, ou o dependente com conta) deve poder confirmar uma toma; o sistema regista quem confirmou e quando. | D7, M4 |
| FR-MED-05 | O sistema deve manter o histórico de tomas (confirmadas e não confirmadas) por membro. | D7 |
| FR-MED-06 | Um plano termina automaticamente no fim da duração, ou quando a receita é concluída/cancelada. | derivado |
| FR-MED-07 | O sistema não deve alertar o Admin por tomas não confirmadas no MVP. | D7 (B, não C) |

## 8. Consultas (APT)

| ID | Requisito | Origem |
|---|---|---|
| FR-APT-01 | O sistema deve permitir criar, editar e cancelar uma consulta de um membro, com data, hora, profissional (texto), clínica e observações. | scope §2 |
| FR-APT-02 | A clínica pode ser escolhida entre as parceiras, ou ser uma entrada privada criada pelo utilizador (R8). | D3 |
| FR-APT-03 | Estados simples: AGENDADA, REALIZADA, CANCELADA, FALTOU (a confirmar na Fase 10). | D9 |
| FR-APT-04 | O sistema deve gerar lembretes de consulta antes da hora (antecedência: ver FR-ALR-04). | scope §2 |
| FR-APT-05 | Não existe fluxo de pedido/confirmação com a clínica no MVP. | D3, D9 |

## 9. Exames (EXM)

| ID | Requisito | Origem |
|---|---|---|
| FR-EXM-01 | O sistema deve permitir registar um exame com tipo/nome, data e estado simples. | scope §2 |
| FR-EXM-02 | Um exame pode ter documento(s) anexo(s) (PDF/JPG/PNG, máx. 10 MB). | M5 |
| FR-EXM-03 | Um exame pode ter resultados estruturados: nome do parâmetro, valor, unidade e intervalo de referência opcional **informado pelo utilizador**. | D8 |
| FR-EXM-04 | O sistema guarda o histórico de exames e resultados por membro. | scope §2 |
| FR-EXM-05 | O sistema **não** interpreta resultados nem gera alertas por valores fora do intervalo no MVP. | D11 |
| FR-EXM-06 | Podem existir exames agendados (futuros) que geram lembretes. | scope §2 (alertas de exame) |

## 10. Documentos (DOC)

| ID | Requisito | Origem |
|---|---|---|
| FR-DOC-01 | Os documentos são guardados fora da base de dados; a BD guarda metadados (dono, tipo, chave, mime, tamanho, checksum, data, política de acesso). | prompt §17 |
| FR-DOC-02 | O upload deve validar tipo (PDF, JPG, PNG) e tamanho (≤10 MB). | M5 |
| FR-DOC-03 | O download só é permitido a quem tem permissão sobre o recurso associado e é auditado. | prompt §16, §20 |
| FR-DOC-04 | Eliminar um recurso elimina os seus documentos. | D15 |

## 11. Alertas e notificações (ALR)

| ID | Requisito | Origem |
|---|---|---|
| FR-ALR-01 | O sistema deve gerar alertas de: toma de medicamento, consulta, exame agendado. | D11 |
| FR-ALR-02 | A geração de alertas segue a cadeia Evento → Regra → Alerta → Notificação, com responsabilidades separadas. | prompt §18 |
| FR-ALR-03 | As notificações são enviadas por push (PWA) e e-mail. | D6, D12 |
| FR-ALR-04 | Antecedência dos lembretes de consulta/exame e antecedência da toma (decidido em R9). | — |
| FR-ALR-05 | O utilizador deve poder escolher os canais ativos (push/e-mail) e desativar tipos de alerta. (decidido em R9) | — |
| FR-ALR-06 | Os alertas ficam listados e podem ser marcados como lidos. | derivado |
| FR-ALR-07 | O texto dos alertas nunca contém diagnóstico. | prompt §8 |
| FR-ALR-08 | Destinatário de alertas de um dependente: o dependente (se tiver conta) e os seus tutores. | M4 (derivado; confirmar R9) |

## 12. Relatórios (RPT)

| ID | Requisito | Origem |
|---|---|---|
| FR-RPT-01 | O sistema deve fornecer via API o relatório individual de um membro: perfil, condições, alergias, receitas, medicamentos, tomas, consultas, exames e resultados. | D10 |
| FR-RPT-02 | O sistema deve fornecer via API a visão familiar: membros, condições, alergias, medicamentos ativos, consultas futuras, exames, itens pendentes. | D10, prompt §19 |
| FR-RPT-03 | Os relatórios só incluem dados existentes e que o utilizador tem permissão de ver (respeitando D13). | prompt §19 |
| FR-RPT-04 | Sem exportação PDF nem partilha por link. | D10 |

## 13. Auditoria e administração

| ID | Requisito | Origem |
|---|---|---|
| FR-AUD-01 | O sistema regista: utilizador, ação, recurso, id do recurso, data/hora, IP, user-agent, resultado. | prompt §20 |
| FR-AUD-02 | São auditadas pelo menos: login, visualização/download de documentos e exames, receitas, alterações de permissões/membros, eliminações. Lista final: Fase 14. | prompt §20 |
| FR-AUD-03 | Ao eliminar dados de um User, os logs são anonimizados. | D15 |
| FR-ADM-01 | O Platform Admin pode listar, suspender e reativar contas, e gerir o cadastro de clínicas parceiras (R8), sem acesso a dados de saúde. | D4 |
| FR-CLN-01 | Existe um cadastro `Clinic` sem utilizadores nem acesso a dados de famílias. Clínicas parceiras são criadas pelo Platform Admin; os utilizadores criam entradas privadas para clínicas não parceiras (R8). | D3 |

---

## 14. DECISÕES DESTA FASE (respondidas em 2026-10-04)

| ID | Decisão | Escolha | Consequência registada |
|---|---|---|---|
| R1 | Verificação de e-mail | **Obrigatória** | Sem e-mail verificado não se usa a conta (FR-AUTH-06). |
| R2 | Eliminar família | **Só se for o único Admin/membro** | Com mais membros, é preciso primeiro removê-los ou transferir a administração (FR-FAM-04). A regra de transferência fica para a Fase 7. |
| R3 | Validade de convites | **7 dias** | O Admin pode reenviar (FR-MEM-03). |
| R4 | Saída/remoção de membro | **O próprio escolhe (adultos)** | Adulto escolhe levar ou apagar os seus dados; dependentes ficam sob a família até serem apagados (FR-MEM-09/10). Detalhe de "levar" (exportação?) na Fase 7. |
| R5 | Partilha entre adultos | **Por categoria de dado** | Categorias a definir na Fase 5 (FR-PRIV-01). |
| R6 | Histórico de alterações | **Só estado atual** | A auditoria regista quem alterou (FR-HP-04). |
| R7 | Receitas/medicamentos | **Médico opcional, data de emissão obrigatória, medicamento avulso permitido** | FR-RX-06, FR-MED-02. |
| R8 | Cadastro de clínicas | **Os dois:** o Platform Admin cria clínicas parceiras (cadastro global); o utilizador cria entradas privadas para clínicas não parceiras | Duas origens de `Clinic`: parceira (global) e privada (de uma família). Ver nota abaixo. |
| R9 | Alertas | **Defaults + preferências por utilizador** | Consulta 24 h e 2 h antes; exame 24 h antes; toma no horário; o utilizador escolhe canais e tipos (FR-ALR-04/05). |
| R10 | Platform Admin | **Listar, suspender e reativar contas** | Sem acesso a dados de saúde (FR-ADM-01). |

### Notas derivadas
- **R8 altera D3:** o Platform Admin passa também a gerir o cadastro de clínicas parceiras. Isto não lhe dá acesso a dados de saúde; amplia R10 e entra em `FR-CLN-01`/`FR-ADM-01`. **Clínica parceira continua sem login e sem acesso a dados de famílias.**
- **[RESOLVIDO na Fase 8 — R11]** `Clinic.type` (PARTNER/PRIVATE) + `familyId`; o utilizador escolhe parceiras ao marcar consulta e **não** promove privadas a parceiras. (Pergunta original: o que distingue "parceira" de "privada" no modelo (campo/estado) e se o utilizador pode transformar uma privada numa parceira equivalente, ou apenas escolher a parceira ao marcar consulta.)
- **R2 (A) vs. FR-FAM-03:** como só se elimina a família quando resta um membro, um Admin que quer sair com outros membros presentes precisa de transferir a administração. **[TBD Fase 7].**

---

*Fim da Fase 3 (v0.2). Requisitos funcionais fechados, salvo os pontos já resolvidos nas fases seguintes (ver `business-rules.md` e `README.md`). Próxima: Fase 4 — Requisitos não funcionais.*
