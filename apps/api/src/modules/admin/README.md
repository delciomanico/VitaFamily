# Módulo `admin`

M9 + Fase 3 (ADR-023): contas — pesquisar/listar, detalhe operacional, suspender, reativar e repor acesso de utilizadores; listar/suspender/reativar contas do portal de uma clínica parceira. **Nunca importa módulos de saúde** (modules.md §3.4, D4/NFR-SEC-10).

- Lista (`q` ≥ 2 caracteres, e-mail ou nome; `status`): `id`, `email`, `name`, `status`, `createdAt`. Detalhe: lista fechada de campos operacionais (BR-ADM-01), contagens vindas de `auth` (sessões) e de uma porta de `families` ligada em `main/api.ts` (só `familiesCount`).
- Suspender/reativar utilizador: motivo obrigatório, sem auto-suspensão, idempotente; `auth` recusa contas `SUSPENDED` (BR-ACC-05).
- `reset-access` (BR-ADM-02): delega em `auth.resetUserAccess` (revoga sessões + e-mail de recuperação/verificação; o token nunca sai de `auth`); não se aplica a si próprio; audita `ADMIN_USER_RESET_ACCESS` com `metadata.kind`.
- Contas de clínica (BR-ADM-03/04): casos de uso em `clinics/application/admin-clinic-accounts.ts` (dono das tabelas); `admin` só liga as rotas. Suspender revoga `clinic_sessions`; reativar `CLINIC_ADMIN` com outro ativo ⇒ `CONFLICT`.
- Só `platformAdmin`; outros recebem `FORBIDDEN`. As restantes rotas `/admin/clinics` continuam em `clinics`.

```
POST /admin/users/{id}/reset-access → interface/router.ts → application/accounts.ts → auth.resetUserAccess + audit
```
