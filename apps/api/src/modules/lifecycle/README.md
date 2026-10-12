# Módulo `lifecycle`

M9 (`plan.md` §4): exportação de dados, saída/remoção de membros com pacote, eliminação de conta, maioridade, bloqueio e apagamento a 90 dias e limpeza de ficheiros.

## Exportação (UC-ACC-06, P2, FR-PRIV-05)
- `POST /users/me/exports` (os meus dados) e `POST /families/{f}/members/{m}/exports` (dependente, só tutor): 202 `DataExport` PENDING; no máximo 3 pedidos/dia (N7).
- O pacote `.zip` (`dados.json` + `documentos/…`) é gerado a seguir ao commit, **no processo da API** (desvio assumido de `modules.md` §5, nota 17). Um pedido perdido (reinício) passa a `FAILED` ao fim de 15 min.
- Só entra o que o pedinte já pode ler (cada leitura passa pela `AccessPolicy` do módulo dono, `platform/reads`). Documentos só com antivírus `CLEAN`; os outros ficam nos metadados com `file: null`.
- Bucket `S3_BUCKET_EXPORTS`; descarga mediada e auditada (`USER_EXPORT_DOWNLOAD`); válida 7 dias. Job `lifecycle.expire-exports` (hora a hora) apaga os pacotes expirados e marca `EXPIRED`.

## Sair da família / remover membro (UC-MEM-08/09, BR-MEM-14/16)
`families` chama a porta `memberData` (ligada em `main/api.ts`): `exportBeforeRemoval` gera e **espera** o pacote antes de apagar (se falhar, a saída/remoção é abortada) e `purgeMemberFiles` enfileira os ficheiros em `file_deletions` na mesma transação. O pacote do membro removido fica acessível ao próprio por `GET /users/me/exports/{id}` (o id vem na resposta ao Admin). **Pendente:** BR-MEM-16 manda também enviar o pacote por e-mail à pessoa removida.

## Eliminar conta (UC-ACC-05, BR-ACC-06/07)
`DELETE /users/me` com a palavra-passe. Primeiro verifica **todas** as famílias (único Admin com outros membros, único tutor de um dependente ou dependente com conta ⇒ `ACCOUNT_DELETION_BLOCKED`, nada é apagado); depois elimina as famílias onde é o único membro (R2), sai das outras com apagamento (R4), apaga a conta, os pacotes de exportação e anonimiza os logs de auditoria. As famílias são tratadas por use cases separados (não numa única transação): uma falha a meio pode deixar a eliminação incompleta, mas repetir o pedido continua de onde parou.

## Maioridade e bloqueio (UC-MEM-10, BR-MEM-10/11, Q7) — jobs diários no worker
- `lifecycle.coming-of-age` (03:00 UTC): avisa o jovem (com conta) e os tutores 30 e 7 dias antes; no dia termina a tutela. Com conta passa a titular (`FAMILY_MEMBER`); **sem conta fica `BLOCKED`**, com apagamento agendado a 90 dias, e o Admin e os tutores são avisados por e-mail. Só afeta quem era menor ao ser criado (um adulto marcado como dependente por consentimento, N3, não é tocado).
- `lifecycle.blocked-members` (03:30 UTC): avisa o Admin aos 30, 60 e 83 dias de bloqueio; aos 90 apaga ficheiros (outbox) e dados e audita `MEMBER_BLOCKED_DELETE`.
- Os avisos coincidem com o dia exato; um dia em que o worker esteja parado perde só o aviso desse dia (a transição e o apagamento usam "já passou", não "é hoje" — o apagamento; a transição de maioridade usa a data exata do aniversário).
- `documents.delete-files` (5 em 5 min) esvazia a outbox `file_deletions` (ADR-011).

## Pendente
- Eliminar uma **família** inteira com outros membros (UC-FAM-06 só permite com um único membro; já implementado em `families`).
- E-mail com o pacote ao membro removido (BR-MEM-16) e notificação dentro da app.
- Transição de maioridade perdida se o worker estiver parado exatamente no dia do aniversário (usar `<=` exige distinguir menor que cresceu de adulto dependente já existente).
