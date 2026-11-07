# ADR-026 — Portal da clínica como ferramenta independente de gestão, ligada ao Vita por consentimento do paciente

**Estado:** **Aceite — decisão do proprietário (2026-11-07), com as recomendações adotadas segundo o critério "máximo valor para a clínica, mínima complexidade para o utilizador"** (change control **D22**). Adenda a ADR-020/023/024; **emenda estreita** a BR-CLN-03 e a BR-CLN-10 (última frase). Não substitui nenhum ADR.
> Nota de numeração: o pedido referia "ADR-025", mas ADR-025/D21 já existe (módulo operacional de seguradoras). Este é o **ADR-026**.

## Contexto
O portal (ADR-020/023/024) é fino: pedidos, agenda, horários, exames, recomendações, marcação presencial e contas. BR-CLN-03 limita a clínica ao mínimo e BR-CLN-10 diz "sem fichas de paciente da clínica". O proprietário quer que o portal seja uma **ferramenta de gestão autónoma** (agenda por profissional, fila do dia, pacientes, preços, recibos, relatórios) que **comunica** com a app Vita, sem que a clínica passe a ver dados de saúde da família sem o paciente querer.

## Decisão
| Tema | Escolha |
|---|---|
| Registo próprio | Cada clínica parceira passa a ter o seu **registo de pacientes** (`ClinicPatient`, "pacientes da clínica"), **separado** dos dados de família/saúde do Vita. A clínica cria-o (paciente sem conta Vita incluído) ou ele nasce de uma marcação/ligação. |
| Papéis RGPD (decidido, OP-26) | **A clínica é responsável pelo tratamento** dos dados do seu registo e dos que cria; **a Vita (Cassfrei) é subcontratante/canal** para esse registo (alojamento, agendamento, mensagens) e **continua responsável** pelos dados da app do paciente. Exige DPA clínica↔Cassfrei e termos de utilização do portal; **DPA e AIPD são gate de lançamento, não bloqueiam o desenvolvimento (inclui mock)**. |
| Ligação ao paciente Vita | `ClinicPatient` pode ficar **ligado** a um utilizador/membro `SELF` por **consentimento do paciente** (convite por código/QR gerado na app, ou aceitação de convite enviado pela clínica). A ligação é por clínica; nunca expõe ids Vita à clínica (mantém BR-CLN-03/10): a ligação vive no servidor (`clinic_patient_links`). |
| Consentimento | Por **clínica**, com **2 níveis visíveis ao paciente**: **"Marcações"** (por omissão: identificação/contacto e consultas/marcações com essa clínica) e **"Partilhar histórico"** (medicação e exames); **um interruptor por clínica**. Internamente as categorias continuam granulares (`ClinicConsent`), mas a app só expõe os 2 níveis. Direção paciente→clínica; mensagens clínica→paciente só estruturadas, com **prazo** (**12 meses**, renovável) e **revogável a qualquer momento** pelo paciente (titular/tutor, como `SharingGrant`). Sem consentimento ativo a clínica não recebe nada além do que já recebe hoje (BR-CLN-03 original). |
| Revogação | Corta **imediatamente** a sincronização **futura** e o acesso da clínica aos dados partilhados pelo Vita; a clínica **conserva o que ela própria criou** (registo, notas, preços, recibos) sob a sua responsabilidade; a **retenção é configurável por clínica, com omissão igual ao mínimo legal** (OP-27). Os dados que o paciente partilhou **a partir da app** deixam de estar visíveis na clínica; cópias que a clínica já guardou no seu registo são dela (aviso explícito ao paciente ao consentir). Auditoria do consentimento e da revogação. |
| Emenda BR-CLN-03 | Ver abaixo: a minimização continua a ser a regra **por omissão e para pacientes sem consentimento**; com consentimento ativo, a clínica vê **só as categorias consentidas**, do **seu** paciente ligado. Nunca dados de outras clínicas, família, tutela ou histórico além das categorias consentidas. |
| Emenda BR-CLN-10 | "Sem fichas de paciente da clínica" é substituída por: a pesquisa por e-mail exato (e a nova por código/QR) mantém a resposta mínima; a **ficha** só existe no registo próprio da clínica (`ClinicPatient`) e só traz dados Vita por consentimento. |
| Fronteiras (fora de âmbito) | **Sem chat livre** (só mensagens estruturadas por catálogo); **sem teleconsulta**; **sem faturação fiscal certificada** (só recibos/comprovativos não fiscais; integração fiscal AGT/e-fatura = decisão futura); **prontuário clínico completo adiado à fase 2** (fica o que existe: resultado, receita, recomendação, BR-CLN-06/08/09); sem IA clínica; sem marketplace/pesquisa pública de pacientes. |
| Preços/recibos (OP-28/29) | Valores em **inteiros (cêntimos)**, moeda **configurável por clínica (omissão AOA)**, preço final **sem desdobrar impostos**; recibo interno **"não fiscal"**, numeração **sequencial por clínica**, serve de comprovativo de reembolso. |
| Papéis (OP-30) | Mantêm-se `CLINIC_ADMIN` e `CLINIC_MANAGER` (o Gestor faz de receção); acrescenta-se **só `CLINIC_DOCTOR`** na fase (f). Auditoria visível só ao `CLINIC_ADMIN`. |
| Dados | Novas entidades em `clinic-portal-v2.md` §2 (modelo por fase). Tudo com `clinic_id` obrigatório e isolamento por clínica (404 sem enumeração). |

## Riscos e mitigação
| Risco | Mitigação |
|---|---|
| Enumeração de contas Vita (já aceite em ADR-024) agravada por pesquisa por código/QR | Código **gerado pelo paciente**, de uso único e **10 min** de validade, mesma resposta 404 genérica, rate limit por conta/IP, auditoria; pesquisa por e-mail mantém-se como em BR-CLN-10. |
| Minimização: a clínica ver mais do que o necessário | Consentimento por categoria; endpoints devolvem só campos da categoria; sem listagens globais de utilizadores; sem exportação massiva (limites e auditoria). |
| Auditoria com PII | Auditoria sem e-mail/telefone/nome/texto livre; só ids internos da clínica e categorias (como `CLINIC_WALKIN_*`). Novas ações em `audit.md` §3 quando se contratar. |
| Isolamento entre clínicas | Toda a query filtra por `clinic_id` da conta; um mesmo paciente Vita em duas clínicas tem **dois** `ClinicPatient` independentes e **dois** consentimentos; testes de isolamento obrigatórios (`vita-qa-security`). |
| Direitos do titular (acesso, retificação, portabilidade, oposição) | O paciente vê na app **que clínicas têm consentimento** e o que partilham; pedidos de acesso/retificação sobre o registo da clínica são dirigidos à clínica (responsável) — a Vita fornece canal e exportação do registo ao titular quando a clínica o pedir (OP-26). |
| Apagamento (D15) | Apagar membro/conta Vita (decidido, OP-27): revoga consentimentos e **remove as ligações e os dados Vita sincronizados**; o registo próprio da clínica **mantém-se** (retenção da clínica), **desligado** e sem ids Vita. Isto **emenda** D15/BR-CLN-09 neste ponto: o que é dado Vita (consultas, recomendações) apaga-se em cascata; o registo da clínica não. |
| Dependentes/menores | Consentimento sempre do titular/tutor; dependente sem conta não consente sozinho (N2). |
| Papéis finos aumentam superfície | Matriz por papel em `authorization.md` §6 (obrigatória antes da fase f); mínimo privilégio; receção não vê notas clínicas. |
| Sobreposição com ADR-025/S3 (seguradoras validam na clínica) | Fase (e) reutiliza a `Encounter` de S3; sem duplicar elegibilidade. |

## Consequências
- Documentação a **contratar fase a fase** (BR/FR/UC, `schema.md`, `openapi.yaml`, `endpoints.md`, `authorization.md` §6, `audit.md`) **antes** de cada marco, como em ADR-023: este ADR e `11-implementation/clinic-portal-v2.md` fixam a direção e o roadmap, **não** o contrato.
- Plano: milestone **M14 "Clínica v2"** (fases a–f) em `plan.md`.
- Gates de lançamento: AIPD (M10) a cobrir o registo da clínica e o consentimento; DPA clínica↔Cassfrei; pendência jurídica Lei 22/11 (`README.md`) .
- Mantêm-se: BR-CLN-04..09, ADR-020 (`ClinicAccount` separado de `User`), 404 sem enumeração.

## Pontos em aberto para o proprietário
**Todos decididos pelo proprietário em 2026-11-07** (OP-24 a OP-30, registados como resolvidos em `11-implementation/open-points.md`). Resta apenas o gate jurídico de lançamento (DPA, AIPD, Lei 22/11).
