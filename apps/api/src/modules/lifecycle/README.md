# Módulo `lifecycle`

M9 (`plan.md` §4). **Implementado nesta fase: exportação de dados** (UC-ACC-06, P2, FR-PRIV-05). **Por implementar:** saída/remoção com pacote, maioridade (avisos 30/7/0 dias), bloqueio e apagamento a 90 dias, eliminação de conta/família, limpeza de ficheiros (`lifecycle.delete-files`).

## Exportação
- `POST /users/me/exports` (os meus dados) e `POST /families/{f}/members/{m}/exports` (dependente, só tutor): 202 `DataExport` PENDING; no máximo 3 pedidos/dia (N7).
- O pacote `.zip` (`dados.json` + `documentos/…`) é gerado a seguir ao commit, **no mesmo processo da API** (desvio assumido de `modules.md` §5, que prevê o job `lifecycle.build-export` no worker: o worker ainda não monta os módulos de saúde). Um pedido que se perca (reinício) passa a `FAILED` ao fim de 15 min.
- Só entra o que o pedinte já pode ler: cada leitura passa pela `AccessPolicy` do módulo dono (`platform/reads`). Documentos só se a análise antivírus estiver `CLEAN`; os outros ficam nos metadados com `file: null`.
- Guardado no bucket `S3_BUCKET_EXPORTS`; descarga mediada, auditada (`USER_EXPORT_DOWNLOAD`), válida 7 dias (depois `EXPIRED`/404).
- Pendente: apagar do bucket os pacotes expirados (`lifecycle.delete-files`).

```
POST /users/me/exports → interface/router.ts → application/exports.ts (rate limit, audit)
  → (depois do commit) application/build-package.ts → sources.* → domain/zip.ts → storage.putObject → markReady
```
