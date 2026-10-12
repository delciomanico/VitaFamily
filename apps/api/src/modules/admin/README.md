# Módulo `admin`

M9 (`plan.md` §4): contas de utilizador — listar, suspender e reativar (FR-ADM-01, R10). **Nunca importa módulos de saúde** (modules.md §3.4, D4/NFR-SEC-10): a listagem só devolve `id`, `email`, `status`, `createdAt`.

- Suspender: exige motivo; não permite auto-suspensão; idempotente; audita `ADMIN_USER_SUSPEND`. `auth` já recusa contas `SUSPENDED` no login, no refresh e a cada pedido (BR-ACC-05), por isso as sessões deixam de valer.
- Reativar: volta a `ACTIVE` (ou `PENDING_VERIFICATION` se o e-mail nunca foi verificado); idempotente; audita `ADMIN_USER_REACTIVATE`.
- Só `platformAdmin` (claim do token); outros recebem `FORBIDDEN`.
- As rotas `/admin/clinics` continuam em `clinics` (modules.md §3 nota 14).

```
POST /admin/users/{userId}/suspend → interface/router.ts → application/accounts.ts → users.setSuspension + audit
```
