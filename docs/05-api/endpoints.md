# Vita Family — Endpoints (Fase 13)

> Estado: **v0.8** (+M15 S/T, 2026-11-08, ADR-027: relatório da consulta `/clinic-portal/agenda/{id}/report*` e `…/appointments/{id}/report*`, rascunho de resultados `…/exam-agenda/{id}/results-draft` e laudo `…/report/pdf`; `report` em `complete`, `generateReport`) — v0.7 (+M14 R, 2026-11-08: recibos `/clinic-portal/receipts*` e `…/clinic-receipts*`, `profile`, `audit`, papel `CLINIC_DOCTOR` e matriz por papel em `authorization.md` §6.2b, `receiptIds` nos pedidos de reembolso) — v0.6 (+M14 Q, 2026-11-08: confirmação ativa, fluxo do dia, indicadores e retorno — `…/appointments/{id}/confirmation`, `/clinic-portal/agenda/{id}/confirm|arrive|start|no-show|follow-up`, `/clinic-portal/follow-ups`, `/clinic-portal/reports/summary`) — v0.5 (+ESBOÇO do módulo operacional de seguradoras, ADR-025 — secção própria, **fora de `openapi.yaml`**) — v0.4 (+D20: `patient-lookup`, `walk-in-appointments`, ADR-024) — ADR-023 (D19): exames, resultados e recomendações da clínica (`/clinic-portal/exam-agenda*`, `PATCH /clinic-portal/slots/{id}` — marcação direta com capacidade, revisto 2026-11-04; `/clinic-portal/recommendations`, `kind` nos horários), recomendações para a família, administração de contas (`/admin/users/{id}`, `reset-access`, `/admin/clinics/{id}/accounts*`, `PATCH /admin/insurers/{id}`) e `GET /families/{id}/insurers`. v0.3 acrescenta o portal da seguradora parceira (ADR-021): `/insurance-portal/*`, `/admin/insurers/{id}/root-account`, apólices e pedidos de reembolso do titular. Mantém v0.2 (portal da clínica, D17/D18): `/clinic-portal/*`, `/admin/clinics/{id}/root-account`, estados `REQUESTED`/`REJECTED` de `Appointment`. Gerado em conjunto com `openapi.yaml` (fonte de verdade). Base: `/api/v1`. Corpo JSON salvo indicação. Autenticação: `Authorization: Bearer <accessToken>`.

## Autenticação do portal da clínica (D17/D18, ADR-020)

As rotas `/clinic-portal/*` usam um **token distinto** do de User: `Authorization: Bearer <clinicAccessToken>`, com claims `clinicAccountId`, `clinicId`, `role` (nunca `userId`/`familyId`). Emitido só por `POST /clinic-portal/auth/login`; nunca aceite nas restantes rotas da API (e o token de User nunca é aceite em `/clinic-portal/*`). Ver ADR-020.

## Autenticação do portal da seguradora (ADR-021)

As rotas `/insurance-portal/*` usam um **token distinto** do de User e do de clínica: `Authorization: Bearer <insuranceAccessToken>`, com claims `insuranceAccountId`, `insurerId`, `role` (nunca `userId`/`familyId`/`clinicAccountId`). Emitido só por `POST /insurance-portal/auth/login`; nunca aceite nas restantes rotas da API (e os outros tokens nunca são aceites em `/insurance-portal/*`). Ver ADR-021 (mirror exato de ADR-020).

## Legenda de AUTHORIZATION

| Código | Significado |
|---|---|
| PUBLIC | Sem autenticação. |
| AUTH | Qualquer User autenticado, ativo, com termos aceites. |
| FAM_MEMBER | Membro (com conta) da família do caminho. |
| FAM_ADMIN | Family Admin da família do caminho. |
| Titular / Tutor | O próprio User ligado ao membro / tutor do dependente. |
| READ(cat) / WRITE(cat) | Ler ou escrever na categoria de dados do membro-sujeito segundo `permissions.md` (titular, tutor, dependente com conta, ou partilha só de leitura). |
| PLATFORM_ADMIN | `platformRole = PLATFORM_ADMIN`. Nunca acede a dados de saúde. |
| CLINIC_ACCOUNT | Qualquer `ClinicAccount` autenticado no portal da própria clínica (`CLINIC_ADMIN`, `CLINIC_MANAGER` ou, desde M14 R, `CLINIC_DOCTOR`), token distinto do de User (ADR-020). **Atenção (M14 R):** onde a rota diz `CLINIC_ACCOUNT`, vale a coluna de papéis de `authorization.md` §6.2b (o Médico só acede às rotas marcadas "suas"; as restantes ⇒ `FORBIDDEN`); as rotas novas de M14 R indicam o papel explicitamente. |
| CLINIC_ADMIN | Só `ClinicAccount` com `role=CLINIC_ADMIN` da própria clínica. |
| CLINIC_ADMIN_MANAGER | `CLINIC_ADMIN` ou `CLINIC_MANAGER` (receção) da própria clínica; `CLINIC_DOCTOR` ⇒ `FORBIDDEN` (M14 R). |
| SELF/TUTOR_OF (seguro) | O próprio titular (adulto) do membro ou o tutor do dependente (ADR-021); sem acesso de `OTHER`, sem categoria de partilha. |
| INSURANCE_ACCOUNT | Qualquer `InsuranceAccount` autenticado no portal da própria seguradora (`INSURANCE_ADMIN` ou `INSURANCE_AGENT`), token distinto do de User/clínica (ADR-021). |
| INSURANCE_ADMIN | Só `InsuranceAccount` com `role=INSURANCE_ADMIN` da própria seguradora. |

**Regras transversais:** negar por defeito; recurso de outra família ou inexistente ⇒ `404`; sem permissão numa família a que se pertence ⇒ `403`; toda ação sensível é auditada; listas com `limit`/`cursor`; datas em ISO-8601 UTC (`date` = `YYYY-MM-DD`); ids UUID.

## Auth

### `POST /auth/register`  — register
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Registar conta (ou aceitar convite de conta de dependente).
- **REQUEST:** `RegisterRequest`
- **RESPONSE:** `202` `Message`
- **ERRORS:** `AGE_REQUIREMENT_NOT_MET`, `DEPENDENT_ACCOUNT_AGE`, `INVITATION_EXPIRED`, `INVITATION_INVALID`, `PASSWORD_WEAK`, `RATE_LIMITED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-ACC-01/02, BR-MEM-12; resposta neutra mesmo que o e-mail já exista (sem enumeração); envia e-mail de verificação; regista termos.

### `POST /auth/verify-email`  — verifyEmail
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Verificar e-mail com token de uso único (24 h).
- **REQUEST:** `VerifyEmailRequest`
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `NOT_FOUND`, `RATE_LIMITED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** Passa o utilizador a ACTIVE.

### `POST /auth/resend-verification`  — resendVerification
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Reenviar e-mail de verificação.
- **REQUEST:** `ResendVerificationRequest`
- **RESPONSE:** `202` `Message`
- **ERRORS:** `RATE_LIMITED`
- **BUSINESS RULES:** Resposta neutra; invalida token anterior.

### `POST /auth/login`  — login
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Iniciar sessão.
- **REQUEST:** `LoginRequest`
- **RESPONSE:** `200` `TokenResponse`
- **ERRORS:** `ACCOUNT_SUSPENDED`, `AUTH_INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `RATE_LIMITED`
- **BUSINESS RULES:** Devolve access token e define cookie `refresh_token` (HttpOnly, Secure, SameSite=Strict, caminho `/api/v1/auth`). Audita sucesso e falha.

### `POST /auth/refresh`  — refreshToken
- **AUTHORIZATION:** PUBLIC (cookie)
- **DESCRIPTION:** Rodar refresh token e obter novo access token.
- **REQUEST:** —
- **RESPONSE:** `200` `TokenResponse`
- **ERRORS:** `ACCOUNT_SUSPENDED`, `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Exige cabeçalho `X-Requested-With: vita`; reutilização de refresh antigo revoga toda a cadeia.

### `POST /auth/logout`  — logout
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Terminar sessão atual.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** Revoga o refresh token e limpa o cookie.

### `POST /auth/password/forgot`  — forgotPassword
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Pedir recuperação de palavra-passe.
- **REQUEST:** `ForgotPasswordRequest`
- **RESPONSE:** `202` `Message`
- **ERRORS:** `RATE_LIMITED`
- **BUSINESS RULES:** Resposta idêntica exista ou não a conta; link de uso único válido 1 h.

### `POST /auth/password/reset`  — resetPassword
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Definir nova palavra-passe com token.
- **REQUEST:** `ResetPasswordRequest`
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `NOT_FOUND`, `PASSWORD_WEAK`, `RATE_LIMITED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** Revoga todas as sessões (BR UC-ACC-03).

### `POST /auth/password/change`  — changePassword
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Alterar palavra-passe (derivado de FR-AUTH).
- **REQUEST:** `ChangePasswordRequest`
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `AUTH_INVALID_CREDENTIALS`, `PASSWORD_WEAK`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Revoga as outras sessões.

## Users

### `GET /users/me`  — getMe
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Ver a minha conta.
- **REQUEST:** —
- **RESPONSE:** `200` `User`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PATCH /users/me`  — updateMe
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Alterar nome e fuso horário.
- **REQUEST:** `UpdateUserRequest`
- **RESPONSE:** `200` `User`
- **ERRORS:** `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** Mudar fuso recalcula tomas futuras (BR-MED-08).

### `DELETE /users/me`  — deleteMe
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Eliminar a minha conta (hard delete).
- **REQUEST:** `DeleteAccountRequest`
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `ACCOUNT_DELETION_BLOCKED`, `AUTH_INVALID_CREDENTIALS`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-ACC-06/07, D15: confirmação por palavra-passe; apaga dados e documentos; anonimiza auditoria. Disponível mesmo com termos por aceitar.

### `POST /users/me/terms-acceptance`  — acceptTerms
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Aceitar a versão atual dos termos.
- **REQUEST:** `AcceptTermsRequest`
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** B6.

### `GET /users/me/notification-preferences`  — getNotificationPreferences
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Ver preferências de notificação.
- **REQUEST:** —
- **RESPONSE:** `200` `NotificationPreferences`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PUT /users/me/notification-preferences`  — putNotificationPreferences
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Definir canais e tipos de alerta.
- **REQUEST:** `NotificationPreferences`
- **RESPONSE:** `200` `NotificationPreferences`
- **ERRORS:** `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** R9, Q3: pode desativar alertas de toma.

### `POST /users/me/push-subscriptions`  — addPushSubscription
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Registar subscrição Web Push.
- **REQUEST:** `PushSubscriptionRequest`
- **RESPONSE:** `201` `PushSubscription`
- **ERRORS:** `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** UC-ALR-06; endpoint repetido atualiza a existente.

### `DELETE /users/me/push-subscriptions/{subscriptionId}`  — deletePushSubscription
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Remover subscrição Web Push.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `POST /users/me/exports`  — requestMyExport
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Pedir exportação dos meus dados (JSON + documentos).
- **REQUEST:** —
- **RESPONSE:** `202` `DataExport`
- **ERRORS:** `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** FR-PRIV-05, N7, Q6: gerada em segundo plano; máx. 3 pedidos por dia.

### `GET /users/me/exports/{exportId}`  — getMyExport
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Estado de uma exportação.
- **REQUEST:** —
- **RESPONSE:** `200` `DataExport`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `GET /users/me/exports/{exportId}/download`  — downloadMyExport
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Descarregar pacote da exportação (zip).
- **REQUEST:** —
- **RESPONSE:** `200` ficheiro binário
- **ERRORS:** `EXPORT_NOT_READY`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Válido 7 dias; auditado.

## Families

### `POST /families`  — createFamily
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Criar família.
- **REQUEST:** `CreateFamilyRequest`
- **RESPONSE:** `201` `Family`
- **ERRORS:** `LIMIT_EXCEEDED`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** FR-FAM-01: cria o FamilyMember do utilizador como FAMILY_ADMIN; máx. 5 famílias (B4).

### `GET /families`  — listFamilies
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Listar as minhas famílias.
- **REQUEST:** —
- **RESPONSE:** `200` `[Family]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `GET /families/{familyId}`  — getFamily
- **AUTHORIZATION:** FAM_MEMBER
- **DESCRIPTION:** Ver família.
- **REQUEST:** —
- **RESPONSE:** `200` `Family`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PATCH /families/{familyId}`  — updateFamily
- **AUTHORIZATION:** FAM_ADMIN
- **DESCRIPTION:** Alterar nome da família.
- **REQUEST:** `UpdateFamilyRequest`
- **RESPONSE:** `200` `Family`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** —

### `DELETE /families/{familyId}`  — deleteFamily
- **AUTHORIZATION:** FAM_ADMIN
- **DESCRIPTION:** Eliminar família.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FAMILY_NOT_EMPTY`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** R2: só com um único membro; apaga tudo (cascata + ficheiros).

### `POST /families/{familyId}/leave`  — leaveFamily
- **AUTHORIZATION:** FAM_MEMBER
- **DESCRIPTION:** Sair da família (adulto), levando ou apagando os dados.
- **REQUEST:** `LeaveFamilyRequest`
- **RESPONSE:** `202` `LeaveFamilyResult`
- **ERRORS:** `FORBIDDEN`, `LAST_ADMIN`, `LAST_GUARDIAN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** R4, Q5, P8: menores/dependentes com conta não saem sozinhos; TAKE gera exportação e só apaga depois de pronta.

## Members

### `GET /families/{familyId}/members`  — listMembers
- **AUTHORIZATION:** FAM_MEMBER
- **DESCRIPTION:** Listar membros.
- **REQUEST:** —
- **RESPONSE:** `200` `[Member]`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Nome e data de nascimento visíveis a todos (BR-PRV-10); dependente com conta só vê nomes (P5).

### `POST /families/{familyId}/members`  — createMember
- **AUTHORIZATION:** FAM_ADMIN
- **DESCRIPTION:** Criar perfil de membro sem conta.
- **REQUEST:** `CreateMemberRequest`
- **RESPONSE:** `201` `Member`
- **ERRORS:** `DEPENDENT_REQUIRES_GUARDIAN`, `FORBIDDEN`, `GUARDIAN_INVALID`, `LIMIT_EXCEEDED`, `MINOR_MUST_BE_DEPENDENT`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** UC-MEM-01, Q7: adulto sem conta só como dependente; máx. 20 membros.

### `GET /families/{familyId}/members/{memberId}`  — getMember
- **AUTHORIZATION:** FAM_MEMBER
- **DESCRIPTION:** Ver membro.
- **REQUEST:** —
- **RESPONSE:** `200` `Member`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PATCH /families/{familyId}/members/{memberId}`  — updateMember
- **AUTHORIZATION:** FAM_ADMIN ou titular ou tutor
- **DESCRIPTION:** Alterar nome ou data de nascimento.
- **REQUEST:** `UpdateMemberRequest`
- **RESPONSE:** `200` `Member`
- **ERRORS:** `FORBIDDEN`, `MINOR_MUST_BE_DEPENDENT`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** Alterar data de nascimento revalida regras de menor/tutor.

### `DELETE /families/{familyId}/members/{memberId}`  — removeMember
- **AUTHORIZATION:** FAM_ADMIN
- **DESCRIPTION:** Remover membro da família.
- **REQUEST:** —
- **RESPONSE:** `202` `LeaveFamilyResult`
- **ERRORS:** `FORBIDDEN`, `LAST_ADMIN`, `LAST_GUARDIAN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MEM-16: adulto com conta recebe pacote de dados antes de apagar; dependente: dados apagados após remoção por Admin e confirmação.

### `PUT /families/{familyId}/members/{memberId}/role`  — setMemberRole
- **AUTHORIZATION:** FAM_ADMIN
- **DESCRIPTION:** Definir papel de família.
- **REQUEST:** `SetRoleRequest`
- **RESPONSE:** `200` `Member`
- **ERRORS:** `FORBIDDEN`, `LAST_ADMIN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** Só adultos com conta podem ser Admin.

### `PUT /families/{familyId}/members/{memberId}/dependent`  — setDependent
- **AUTHORIZATION:** FAM_ADMIN (menor ou adulto sem conta) ou titular (adulto com conta)
- **DESCRIPTION:** Marcar/desmarcar como dependente e definir tutores.
- **REQUEST:** `SetDependentRequest`
- **RESPONSE:** `200` `Member`
- **ERRORS:** `DEPENDENT_REQUIRES_GUARDIAN`, `FORBIDDEN`, `GUARDIAN_INVALID`, `MINOR_MUST_BE_DEPENDENT`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Q7: adulto com conta só se marca a si próprio (consentimento implícito).

### `GET /families/{familyId}/members/{memberId}/guardians`  — listGuardians
- **AUTHORIZATION:** FAM_MEMBER
- **DESCRIPTION:** Listar tutores do dependente.
- **REQUEST:** —
- **RESPONSE:** `200` `[Guardianship]`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `POST /families/{familyId}/members/{memberId}/guardians`  — addGuardian
- **AUTHORIZATION:** FAM_ADMIN (ou titular, se adulto com conta)
- **DESCRIPTION:** Adicionar tutor.
- **REQUEST:** `AddGuardianRequest`
- **RESPONSE:** `201` `Guardianship`
- **ERRORS:** `CONFLICT`, `FORBIDDEN`, `GUARDIAN_INVALID`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `DELETE /families/{familyId}/members/{memberId}/guardians/{guardianMemberId}`  — removeGuardian
- **AUTHORIZATION:** FAM_ADMIN (ou titular, se adulto com conta)
- **DESCRIPTION:** Remover tutor.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `LAST_GUARDIAN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MEM-07, P8.

### `PUT /families/{familyId}/members/{memberId}/guardians/primary`  — setPrimaryGuardian
- **AUTHORIZATION:** FAM_ADMIN (ou titular, se adulto com conta)
- **DESCRIPTION:** Definir tutor principal.
- **REQUEST:** `SetPrimaryGuardianRequest`
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `GUARDIAN_INVALID`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MEM-06: exatamente um principal.

### `POST /families/{familyId}/members/{memberId}/exports`  — requestDependentExport
- **AUTHORIZATION:** Tutor
- **DESCRIPTION:** Exportar dados de um dependente.
- **REQUEST:** —
- **RESPONSE:** `202` `DataExport`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** P2: tutor exporta pelo dependente.

## Invitations

### `GET /families/{familyId}/invitations`  — listInvitations
- **AUTHORIZATION:** FAM_ADMIN
- **DESCRIPTION:** Listar convites.
- **REQUEST:** —
- **RESPONSE:** `200` `[Invitation]`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `POST /families/{familyId}/invitations`  — createInvitation
- **AUTHORIZATION:** FAM_ADMIN
- **DESCRIPTION:** Convidar pessoa por e-mail.
- **REQUEST:** `CreateInvitationRequest`
- **RESPONSE:** `201` `Invitation`
- **ERRORS:** `CONFLICT`, `FORBIDDEN`, `LIMIT_EXCEEDED`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** D14, R3: validade 7 dias; máx. 20 pendentes; `memberId` liga a perfil sem conta existente.

### `DELETE /families/{familyId}/invitations/{invitationId}`  — revokeInvitation
- **AUTHORIZATION:** FAM_ADMIN (ou tutor, se for de conta de dependente)
- **DESCRIPTION:** Revogar convite pendente.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `POST /families/{familyId}/members/{memberId}/account-invitation`  — createDependentAccountInvitation
- **AUTHORIZATION:** Tutor
- **DESCRIPTION:** Autorizar e convidar conta limitada para um dependente.
- **REQUEST:** `CreateDependentAccountInvitationRequest`
- **RESPONSE:** `201` `Invitation`
- **ERRORS:** `DEPENDENT_ACCOUNT_AGE`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** P2, B3, N2: ≥13 anos; conta de acesso limitado.

### `POST /invitations/lookup`  — lookupInvitation
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Ver dados mínimos de um convite.
- **REQUEST:** `InvitationLookupRequest`
- **RESPONSE:** `200` `InvitationPreview`
- **ERRORS:** `INVITATION_EXPIRED`, `INVITATION_INVALID`, `RATE_LIMITED`
- **BUSINESS RULES:** Token no corpo (nunca no URL).

### `POST /invitations/accept`  — acceptInvitation
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Aceitar convite.
- **REQUEST:** `AcceptInvitationRequest`
- **RESPONSE:** `200` `Member`
- **ERRORS:** `BIRTHDATE_MISMATCH`, `CONFLICT`, `INVITATION_EMAIL_MISMATCH`, `INVITATION_EXPIRED`, `INVITATION_INVALID`, `LIMIT_EXCEEDED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MEM-12/13/17.

## Sharing

### `GET /families/{familyId}/members/{memberId}/sharing`  — getSharing
- **AUTHORIZATION:** Titular ou tutor
- **DESCRIPTION:** Ver partilha por categoria.
- **REQUEST:** —
- **RESPONSE:** `200` `SharingSettings`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PUT /families/{familyId}/members/{memberId}/sharing`  — putSharing
- **AUTHORIZATION:** Titular ou tutor
- **DESCRIPTION:** Definir partilha (substitui as concessões).
- **REQUEST:** `SharingSettings`
- **RESPONSE:** `200` `SharingSettings`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-PRV-01..04: só leitura; efeito imediato; destinatário nulo = toda a família.

### M14 fase (P) — consentimento e ligação a clínicas (lado família; ADR-026; contrato 2026-11-08)

> Autorização de todas as rotas: titular adulto (`SELF`) ou tutor (`TUTOR_OF`); `DEPENDENT_SELF` e `OTHER` nunca (`authorization.md` §6.4). O dependente sem conta é gerido pelos tutores (N2).

### `GET /families/{familyId}/members/{memberId}/clinic-consents`  — listClinicConsents
- **AUTHORIZATION:** Titular (SELF adulto) ou tutor
- **DESCRIPTION:** "Quem vê o quê": clínicas parceiras com consentimento e/ou ligação ao membro (UC-CLN-16).
- **REQUEST:** —
- **RESPONSE:** `200` `[ClinicConsent]`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-19. `level` é o efetivo: um `HISTORY` expirado aparece como `BOOKINGS` com `renewalNeeded=true`.

### `PUT /families/{familyId}/members/{memberId}/clinic-consents/{clinicId}`  — putClinicConsent
- **AUTHORIZATION:** Titular (SELF adulto) ou tutor
- **DESCRIPTION:** Conceder, alterar ou renovar o consentimento de uma clínica parceira (UC-CLN-16).
- **REQUEST:** `ClinicConsentInput` (`level`: `BOOKINGS`\|`HISTORY`)
- **RESPONSE:** `200` `ClinicConsent`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND` (clínica inexistente/não parceira/não ativa), `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-19. `HISTORY` fixa a validade em agora + 12 meses (repetir = renovar); `BOOKINGS` remove a partilha do histórico. Efeito imediato, idempotente; pode existir antes de a clínica ter ligado o paciente. Auditoria `CLINIC_CONSENT_SET`.

### `DELETE /families/{familyId}/members/{memberId}/clinic-consents/{clinicId}`  — revokeClinicConsent
- **AUTHORIZATION:** Titular (SELF adulto) ou tutor
- **DESCRIPTION:** Revogar o consentimento e a ligação da clínica (UC-CLN-16).
- **REQUEST:** —
- **RESPONSE:** `204`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND` (sem consentimento nem ligação), `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-19: apaga consentimento e ligação (a leitura da clínica cessa na hora); o registo da clínica mantém-se desligado. Auditoria `CLINIC_CONSENT_REVOKE`.

### `POST /families/{familyId}/members/{memberId}/clinic-link-codes`  — createClinicLinkCode
- **AUTHORIZATION:** Titular (SELF adulto) ou tutor
- **DESCRIPTION:** Gerar o código/QR (uso único, 10 min) a mostrar à clínica (UC-CLN-15).
- **REQUEST:** —
- **RESPONSE:** `201` `ClinicLinkCode` (`code`, `expiresAt`)
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-20. Novo código invalida o anterior do membro; 5 códigos/hora por membro; só o hash fica guardado. Auditoria `CLINIC_LINK_CODE_CREATE` (sem o código).

### `GET /families/{familyId}/members/{memberId}/clinic-receipts`  — listFamilyClinicReceipts
- **AUTHORIZATION:** Titular (SELF adulto) ou tutor (§6.5)
- **DESCRIPTION:** Recibos das clínicas recebidos pelo membro, como comprovativos (UC-CLN-28, M14 R).
- **QUERY:** `limit` (1–100, omissão 25), `cursor`
- **REQUEST:** —
- **RESPONSE:** `200` `FamilyClinicReceiptPage`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-35: só recibos com ligação (marcação Vita com consentimento na emissão); mais recentes primeiro; inclui `VOIDED` (mostrado como "Anulado"). Não auditado.

### `GET /families/{familyId}/members/{memberId}/clinic-receipts/{receiptId}`  — getFamilyClinicReceipt
- **AUTHORIZATION:** Titular (SELF adulto) ou tutor (§6.5)
- **DESCRIPTION:** Ver um recibo recebido (para imprimir/guardar como PDF no navegador).
- **REQUEST:** —
- **RESPONSE:** `200` `FamilyClinicReceipt`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-35: sem motivo de anulação nem ids da clínica. O recibo pode ser anexado a um pedido de reembolso (`receiptIds`, BR-CLN-36).

### `GET /families/{familyId}/shared-with-me`  — sharedWithMe
- **AUTHORIZATION:** FAM_MEMBER
- **DESCRIPTION:** O que foi partilhado comigo.
- **REQUEST:** —
- **RESPONSE:** `200` `[SharedWithMeItem]`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** UC-PRV-02.

## Health records

### `GET /families/{familyId}/members/{memberId}/blood-type`  — getBloodType
- **AUTHORIZATION:** READ(ALLERGIES)
- **DESCRIPTION:** Ver tipo sanguíneo.
- **REQUEST:** —
- **RESPONSE:** `200` `BloodType`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PUT /families/{familyId}/members/{memberId}/blood-type`  — putBloodType
- **AUTHORIZATION:** WRITE(ALLERGIES)
- **DESCRIPTION:** Definir tipo sanguíneo.
- **REQUEST:** `BloodType`
- **RESPONSE:** `200` `BloodType`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** —

### `GET /families/{familyId}/members/{memberId}/allergies`  — listAllergies
- **AUTHORIZATION:** READ(ALLERGIES)
- **DESCRIPTION:** Listar alergias.
- **REQUEST:** —
- **RESPONSE:** `200` `[Allergy]`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `POST /families/{familyId}/members/{memberId}/allergies`  — createAllergy
- **AUTHORIZATION:** WRITE(ALLERGIES)
- **DESCRIPTION:** Adicionar alergia.
- **REQUEST:** `AllergyInput`
- **RESPONSE:** `201` `Allergy`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** —

### `PATCH /families/{familyId}/members/{memberId}/allergies/{allergyId}`  — updateAllergy
- **AUTHORIZATION:** WRITE(ALLERGIES)
- **DESCRIPTION:** Alterar alergia.
- **REQUEST:** `AllergyPatch`
- **RESPONSE:** `200` `Allergy`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** R6: só estado atual.

### `DELETE /families/{familyId}/members/{memberId}/allergies/{allergyId}`  — deleteAllergy
- **AUTHORIZATION:** WRITE(ALLERGIES)
- **DESCRIPTION:** Remover alergia.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `GET /families/{familyId}/members/{memberId}/conditions`  — listConditions
- **AUTHORIZATION:** READ(CONDITIONS)
- **DESCRIPTION:** Listar condições e histórico médico.
- **REQUEST:** —
- **RESPONSE:** `200` `[Condition]`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `POST /families/{familyId}/members/{memberId}/conditions`  — createCondition
- **AUTHORIZATION:** WRITE(CONDITIONS)
- **DESCRIPTION:** Adicionar condição ou histórico.
- **REQUEST:** `ConditionInput`
- **RESPONSE:** `201` `Condition`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** —

### `PATCH /families/{familyId}/members/{memberId}/conditions/{conditionId}`  — updateCondition
- **AUTHORIZATION:** WRITE(CONDITIONS)
- **DESCRIPTION:** Alterar condição.
- **REQUEST:** `ConditionPatch`
- **RESPONSE:** `200` `Condition`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** —

### `DELETE /families/{familyId}/members/{memberId}/conditions/{conditionId}`  — deleteCondition
- **AUTHORIZATION:** WRITE(CONDITIONS)
- **DESCRIPTION:** Remover condição.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

## Prescriptions

### `GET /families/{familyId}/members/{memberId}/prescriptions`  — listPrescriptions
- **AUTHORIZATION:** READ(MEDICATION)
- **DESCRIPTION:** Listar receitas.
- **QUERY:** `status` (string), `limit` (int), `cursor` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `{ items: [Prescription], nextCursor }`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Filtro por estado.

### `POST /families/{familyId}/members/{memberId}/prescriptions`  — createPrescription
- **AUTHORIZATION:** WRITE(MEDICATION)
- **DESCRIPTION:** Registar receita com medicamentos (cria os planos de toma).
- **REQUEST:** `PrescriptionInput`
- **RESPONSE:** `201` `Prescription`
- **ERRORS:** `FORBIDDEN`, `INVALID_SCHEDULE`, `MEMBER_BLOCKED`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-RX-01/02, M2, R7: data de emissão obrigatória e não futura; ≥1 medicamento; gera tomas e alertas.

### `GET /families/{familyId}/members/{memberId}/prescriptions/{prescriptionId}`  — getPrescription
- **AUTHORIZATION:** READ(MEDICATION)
- **DESCRIPTION:** Ver receita.
- **REQUEST:** —
- **RESPONSE:** `200` `Prescription`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PATCH /families/{familyId}/members/{memberId}/prescriptions/{prescriptionId}`  — updatePrescription
- **AUTHORIZATION:** WRITE(MEDICATION)
- **DESCRIPTION:** Alterar dados da receita.
- **REQUEST:** `PrescriptionPatch`
- **RESPONSE:** `200` `Prescription`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** —

### `DELETE /families/{familyId}/members/{memberId}/prescriptions/{prescriptionId}`  — deletePrescription
- **AUTHORIZATION:** WRITE(MEDICATION)
- **DESCRIPTION:** Eliminar receita, planos, tomas e documentos.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-RX-06; aconselhar CANCELAR; documentos apagados via outbox.

### `PUT /families/{familyId}/members/{memberId}/prescriptions/{prescriptionId}/status`  — setPrescriptionStatus
- **AUTHORIZATION:** WRITE(MEDICATION)
- **DESCRIPTION:** Concluir, cancelar ou reabrir receita.
- **REQUEST:** `PrescriptionStatusRequest`
- **RESPONSE:** `200` `Prescription`
- **ERRORS:** `FORBIDDEN`, `INVALID_STATE_TRANSITION`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** ST1; terminar a receita termina os planos associados.

### `POST /families/{familyId}/members/{memberId}/prescriptions/{prescriptionId}/medications`  — addPrescriptionMedication
- **AUTHORIZATION:** WRITE(MEDICATION)
- **DESCRIPTION:** Acrescentar medicamento (plano) à receita.
- **REQUEST:** `MedicationPlanInput`
- **RESPONSE:** `201` `MedicationPlan`
- **ERRORS:** `FORBIDDEN`, `INVALID_SCHEDULE`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** —

## Medications

### `GET /families/{familyId}/members/{memberId}/medication-plans`  — listMedicationPlans
- **AUTHORIZATION:** READ(MEDICATION)
- **DESCRIPTION:** Listar planos de toma (medicamentos).
- **QUERY:** `status` (string), `limit` (int), `cursor` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `{ items: [MedicationPlan], nextCursor }`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Dependente com conta lê (N2).

### `POST /families/{familyId}/members/{memberId}/medication-plans`  — createMedicationPlan
- **AUTHORIZATION:** WRITE(MEDICATION)
- **DESCRIPTION:** Criar plano avulso (sem receita).
- **REQUEST:** `MedicationPlanInput`
- **RESPONSE:** `201` `MedicationPlan`
- **ERRORS:** `FORBIDDEN`, `INVALID_SCHEDULE`, `MEMBER_BLOCKED`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** R7, B5, Q1.

### `GET /families/{familyId}/members/{memberId}/medication-plans/{planId}`  — getMedicationPlan
- **AUTHORIZATION:** READ(MEDICATION)
- **DESCRIPTION:** Ver plano.
- **REQUEST:** —
- **RESPONSE:** `200` `MedicationPlan`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PATCH /families/{familyId}/members/{memberId}/medication-plans/{planId}`  — updateMedicationPlan
- **AUTHORIZATION:** WRITE(MEDICATION)
- **DESCRIPTION:** Alterar plano (efeito só no futuro).
- **REQUEST:** `MedicationPlanPatch`
- **RESPONSE:** `200` `MedicationPlan`
- **ERRORS:** `FORBIDDEN`, `INVALID_SCHEDULE`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-RX-05: recalcula tomas PENDING futuras.

### `PUT /families/{familyId}/members/{memberId}/medication-plans/{planId}/status`  — setMedicationPlanStatus
- **AUTHORIZATION:** WRITE(MEDICATION)
- **DESCRIPTION:** Terminar ou reativar plano.
- **REQUEST:** `PlanStatusRequest`
- **RESPONSE:** `200` `MedicationPlan`
- **ERRORS:** `FORBIDDEN`, `INVALID_SCHEDULE`, `INVALID_STATE_TRANSITION`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** ST1.

### `DELETE /families/{familyId}/members/{memberId}/medication-plans/{planId}`  — deleteMedicationPlan
- **AUTHORIZATION:** WRITE(MEDICATION)
- **DESCRIPTION:** Eliminar plano e o seu histórico de tomas.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Aconselhar terminar em vez de eliminar.

### `GET /families/{familyId}/members/{memberId}/doses`  — listDoses
- **AUTHORIZATION:** READ(MEDICATION)
- **DESCRIPTION:** Listar tomas (agenda e histórico).
- **QUERY:** `from` (datetime), `to` (datetime), `status` (string), `planId` (uuid), `limit` (int), `cursor` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `{ items: [Dose], nextCursor }`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** FR-MED-05; filtros por período, estado e plano.

### `POST /families/{familyId}/members/{memberId}/doses/{doseId}/taken`  — markDoseTaken
- **AUTHORIZATION:** Titular, tutor ou dependente com conta
- **DESCRIPTION:** Confirmar toma.
- **REQUEST:** `DoseActionRequest`
- **RESPONSE:** `200` `Dose`
- **ERRORS:** `DOSE_IN_FUTURE`, `DOSE_WINDOW_EXPIRED`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** D7, M4, Q2: idempotente; regista quem e quando.

### `POST /families/{familyId}/members/{memberId}/doses/{doseId}/not-taken`  — markDoseNotTaken
- **AUTHORIZATION:** Titular, tutor ou dependente com conta
- **DESCRIPTION:** Marcar toma como não tomada.
- **REQUEST:** `DoseActionRequest`
- **RESPONSE:** `200` `Dose`
- **ERRORS:** `DOSE_IN_FUTURE`, `DOSE_WINDOW_EXPIRED`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PUT /families/{familyId}/members/{memberId}/doses/{doseId}`  — correctDose
- **AUTHORIZATION:** Quem agiu, titular ou tutor
- **DESCRIPTION:** Corrigir estado de toma (até 7 dias).
- **REQUEST:** `DoseCorrectionRequest`
- **RESPONSE:** `200` `Dose`
- **ERRORS:** `DOSE_WINDOW_EXPIRED`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** ST2; auditado.

## Appointments

### `GET /families/{familyId}/members/{memberId}/appointments`  — listAppointments
- **AUTHORIZATION:** READ(APPOINTMENTS)
- **DESCRIPTION:** Listar consultas.
- **QUERY:** `status` (string), `from` (datetime), `to` (datetime), `limit` (int), `cursor` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `{ items: [Appointment], nextCursor }`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Dependente com conta lê (N2).

### `POST /families/{familyId}/members/{memberId}/appointments`  — createAppointment
- **AUTHORIZATION:** WRITE(APPOINTMENTS)
- **DESCRIPTION:** Criar consulta privada ou sem clínica (nasce `SCHEDULED`). Para marcar num horário de clínica parceira, usar `slotId` em vez de `clinicId`/`clinicName` (nasce `REQUESTED`, BR-APT-04/D17).
- **REQUEST:** `AppointmentInput`
- **RESPONSE:** `201` `Appointment`
- **ERRORS:** `FORBIDDEN`, `MEMBER_BLOCKED`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`, `CONFLICT` (`slotId` já tem marcação ativa, BR-APT-06)
- **BUSINESS RULES:** FR-APT-01; gera lembretes 24 h e 2 h se futura (só se `SCHEDULED`, BR-APT-07); o utilizador é avisado da minimização (BR-CLN-03) antes de enviar um pedido com `slotId`.

### `GET /families/{familyId}/members/{memberId}/appointments/{appointmentId}`  — getAppointment
- **AUTHORIZATION:** READ(APPOINTMENTS)
- **DESCRIPTION:** Ver consulta.
- **REQUEST:** —
- **RESPONSE:** `200` `Appointment`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `GET /families/{familyId}/members/{memberId}/appointments/{appointmentId}/report`  — getFamilyConsultationReport
- **AUTHORIZATION:** Titular (SELF adulto) ou tutor (TUTOR_OF) com READ(APPOINTMENTS) (`authorization.md` §6.6)
- **DESCRIPTION:** Ler o relatório da consulta emitido pela clínica (UC-CLN-36, M15 S).
- **RESPONSE:** `200` `FamilyConsultationReport`
- **ERRORS:** `FORBIDDEN` (DEPENDENT_SELF, OTHER), `NOT_FOUND` (sem relatório `FINAL` partilhado, visita manual, outra família), `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-45: independente de `ClinicConsent`; sem ids da clínica/conta. Auditado quando lido por tutor.

### `GET /families/{familyId}/members/{memberId}/appointments/{appointmentId}/report/pdf`  — getFamilyConsultationReportPdf
- **AUTHORIZATION:** como o anterior
- **DESCRIPTION:** Descarregar o PDF do relatório.
- **RESPONSE:** `200` `application/pdf` (`Content-Disposition: attachment`)
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED` (sem limite próprio; só o geral, OP-50)
- **BUSINESS RULES:** BR-CLN-45/46. Sempre auditado (`CONSULT_REPORT_VIEWED`, `format=PDF`).

### `PATCH /families/{familyId}/members/{memberId}/appointments/{appointmentId}`  — updateAppointment
- **AUTHORIZATION:** WRITE(APPOINTMENTS)
- **DESCRIPTION:** Alterar/reagendar consulta.
- **REQUEST:** `AppointmentPatch`
- **RESPONSE:** `200` `Appointment`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** Recalcula lembretes futuros.

### `DELETE /families/{familyId}/members/{memberId}/appointments/{appointmentId}`  — deleteAppointment
- **AUTHORIZATION:** WRITE(APPOINTMENTS)
- **DESCRIPTION:** Eliminar consulta.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PUT /families/{familyId}/members/{memberId}/appointments/{appointmentId}/status`  — setAppointmentStatus
- **AUTHORIZATION:** WRITE(APPOINTMENTS)
- **DESCRIPTION:** Marcar realizada, faltou, cancelada ou reagendar. A família nunca define `REQUESTED`/`REJECTED`/`SCHEDULED` a partir de `REQUESTED` (transições exclusivas do portal da clínica, `PUT /clinic-portal/requests/{appointmentId}`, D17); só desiste de um pedido (`REQUESTED → CANCELLED`).
- **REQUEST:** `AppointmentStatusRequest`
- **RESPONSE:** `200` `Appointment`
- **ERRORS:** `FORBIDDEN`, `INVALID_STATE_TRANSITION`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** ST4.

### `PUT /families/{familyId}/members/{memberId}/appointments/{appointmentId}/confirmation`  — setAppointmentConfirmation
- **AUTHORIZATION:** WRITE(APPOINTMENTS)
- **DESCRIPTION:** Responder ao pedido de confirmação: **"Vou"** (`GOING`) ou **"Não posso"** (`CANNOT`, cancela a consulta e liberta o horário) (UC-CLN-20, M14 Q).
- **REQUEST:** `AppointmentConfirmationRequest` (`{ response: GOING\|CANNOT }`)
- **RESPONSE:** `200` `Appointment` (com `confirmationStatus`)
- **ERRORS:** `FORBIDDEN`, `INVALID_STATE_TRANSITION` (não `SCHEDULED`, já passou, ou `GOING` depois de `CANNOT`), `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR` (consulta sem clínica parceira)
- **BUSINESS RULES:** BR-CLN-25/26, BR-APT-06 (horário livre), BR-APT-09 (remarcar = pedir outro horário). Idempotente. Auditoria `APPOINTMENT_CONFIRMATION_SET`.

### `GET /families/{familyId}/clinics/{clinicId}/slots`  — listAvailableSlots
- **AUTHORIZATION:** FAM_MEMBER
- **DESCRIPTION:** Listar horários livres e futuros de uma clínica parceira, para escolher ao marcar (D17).
- **QUERY:** `kind` (`APPOINTMENT`\|`EXAM`, default `APPOINTMENT`, BR-APT-10), `specialty` (string; em `EXAM` é o tipo de exame), `from` (datetime), `to` (datetime)
- **REQUEST:** —
- **RESPONSE:** `200` `[AvailableSlot]`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-APT-06/BR-APT-11: `kind=APPOINTMENT` só horários sem marcação ativa (`REQUESTED`/`SCHEDULED`); `kind=EXAM` só horários com vagas (`remaining ≥ 1`, i.e. exames `SCHEDULED` < `capacity`). `AvailableSlot` traz `capacity` e `remaining`.

## Clinics

### `GET /families/{familyId}/clinics`  — listClinics
- **AUTHORIZATION:** FAM_MEMBER
- **DESCRIPTION:** Listar clínicas parceiras e privadas da família.
- **QUERY:** `status` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `[Clinic]`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** R8.

### `POST /families/{familyId}/clinics`  — createPrivateClinic
- **AUTHORIZATION:** FAM_MEMBER (adulto)
- **DESCRIPTION:** Criar clínica privada.
- **REQUEST:** `ClinicInput`
- **RESPONSE:** `201` `Clinic`
- **ERRORS:** `FORBIDDEN`, `LIMIT_EXCEEDED`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-01: máx. 10 por família (B4).

### `PATCH /families/{familyId}/clinics/{clinicId}`  — updatePrivateClinic
- **AUTHORIZATION:** Criador ou FAM_ADMIN
- **DESCRIPTION:** Alterar clínica privada.
- **REQUEST:** `ClinicPatch`
- **RESPONSE:** `200` `Clinic`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** Parceiras não se alteram aqui.

### `PUT /families/{familyId}/clinics/{clinicId}/status`  — setPrivateClinicStatus
- **AUTHORIZATION:** Criador ou FAM_ADMIN
- **DESCRIPTION:** Arquivar/reativar clínica privada.
- **REQUEST:** `ClinicStatusRequest`
- **RESPONSE:** `200` `Clinic`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `DELETE /families/{familyId}/clinics/{clinicId}`  — deletePrivateClinic
- **AUTHORIZATION:** Criador ou FAM_ADMIN
- **DESCRIPTION:** Eliminar clínica privada.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-02: consultas mantêm o nome em texto.

## Clinic Portal (`/clinic-portal/*`, D17/D18, ADR-020)

> Autenticação por `clinicAccessToken` (ver topo do documento), **nunca** `Authorization: Bearer` de User. Nenhuma rota aqui aceita `familyId`/`memberId`; o recurso é sempre resolvido pela clínica do token (§6.1 de `authorization.md`). Minimização: o portal nunca devolve condições, alergias, medicação prévia, histórico de outras consultas, nem dados de família/tutela (BR-CLN-03).

### `POST /clinic-portal/auth/login`  — clinicLogin
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Iniciar sessão de uma conta do portal da clínica (`CLINIC_ADMIN`, `CLINIC_MANAGER` ou `CLINIC_DOCTOR`).
- **REQUEST:** `ClinicLoginRequest`
- **RESPONSE:** `200` `ClinicTokenResponse`
- **ERRORS:** `ACCOUNT_SUSPENDED`, `AUTH_INVALID_CREDENTIALS`, `RATE_LIMITED`
- **BUSINESS RULES:** Define cookie `clinic_refresh_token` (HttpOnly, Secure, SameSite=Strict, caminho `/api/v1/clinic-portal/auth`), independente do cookie `refresh_token` de User (ADR-020). Audita sucesso e falha.

### `POST /clinic-portal/auth/refresh`  — clinicRefreshToken
- **AUTHORIZATION:** PUBLIC (cookie)
- **DESCRIPTION:** Rodar refresh token da clínica e obter novo access token.
- **REQUEST:** —
- **RESPONSE:** `200` `ClinicTokenResponse`
- **ERRORS:** `ACCOUNT_SUSPENDED`, `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Mesma política de rotação/reutilização de `auth/refresh`, em `clinic_sessions`.

### `POST /clinic-portal/auth/logout`  — clinicLogout
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Terminar sessão atual do portal.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** Revoga o refresh token da clínica e limpa o cookie.

### `GET /clinic-portal/staff`  — listClinicStaff
- **AUTHORIZATION:** CLINIC_ADMIN
- **DESCRIPTION:** Listar as contas `CLINIC_MANAGER` e `CLINIC_DOCTOR` da própria clínica (BR-CLN-05/39).
- **REQUEST:** —
- **RESPONSE:** `200` `[ClinicAccount]`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Nunca lista a conta `CLINIC_ADMIN` de outra clínica.

### `POST /clinic-portal/staff`  — createClinicStaff
- **AUTHORIZATION:** CLINIC_ADMIN
- **DESCRIPTION:** Criar uma conta `CLINIC_MANAGER` (receção, omissão) ou `CLINIC_DOCTOR` (Médico) na própria clínica (self-service, BR-CLN-05/39, UC-CLN-30).
- **REQUEST:** `ClinicStaffInput` (`email`, `role?`, `professionalId?`)
- **RESPONSE:** `201` `ClinicAccount`
- **ERRORS:** `CONFLICT` (e-mail existente; profissional já com conta Médico), `FORBIDDEN`, `NOT_FOUND` (profissional inexistente, inativo ou de outra clínica), `UNAUTHENTICATED`, `VALIDATION_ERROR` (Médico sem `professionalId`; Gestor com `professionalId`)
- **BUSINESS RULES:** BR-CLN-05/39: o Platform Admin nunca cria Gestores nem Médicos. Auditoria `CLINIC_STAFF_CREATE` (`metadata.role`).

### `DELETE /clinic-portal/staff/{clinicAccountId}`  — removeClinicStaff
- **AUTHORIZATION:** CLINIC_ADMIN
- **DESCRIPTION:** Remover uma conta `CLINIC_MANAGER` ou `CLINIC_DOCTOR` da própria clínica.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Só remove contas `CLINIC_MANAGER`/`CLINIC_DOCTOR`; a conta `CLINIC_ADMIN` raiz só é reposta pelo Platform Admin (`POST /admin/clinics/{id}/root-account`).

### `GET /clinic-portal/slots`  — listOwnClinicSlots
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Listar horários da própria clínica com a ocupação (UC-CLN-04/07). D19: filtra por `kind`. Cada `ClinicSlotView` traz `capacity`, `bookedCount`, `remaining` e `state`.
- **QUERY:** `kind` (`APPOINTMENT`\|`EXAM`, opcional), `from` (datetime), `to` (datetime)
- **REQUEST:** —
- **RESPONSE:** `200` `[ClinicSlotView]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-04.

### `POST /clinic-portal/slots`  — publishClinicSlots
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Publicar um ou mais horários num dia (UC-CLN-04).
- **REQUEST:** `ClinicSlotBatchInput`
- **RESPONSE:** `201` `[ClinicSlot]`
- **ERRORS:** `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-04; ignora horas passadas e duplicadas (mesma hora, `kind`, especialidade e profissional). M14: com `professionalId`/`serviceTypeId` (opcionais; BR-CLN-11) aplica-se BR-CLN-13 (sobreposição ⇒ `CONFLICT`, nada criado) e BR-CLN-14 (bloqueio ⇒ `CONFLICT`); `NOT_FOUND` se de outra clínica. D19: `kind=EXAM` publica horários de exame (UC-CLN-07) com `capacity` vagas (1–50, default 1; em `APPOINTMENT` só 1, BR-APT-11).

### `PATCH /clinic-portal/slots/{slotId}`  — updateClinicSlot
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Alterar a capacidade de um horário de exame (ADR-023, revisto 2026-11-04).
- **REQUEST:** `ClinicSlotPatch`
- **RESPONSE:** `200` `ClinicSlotView`
- **ERRORS:** `CONFLICT` (`capacity` inferior às marcações ativas), `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR` (`capacity` fora de 1–50; horário `kind=APPOINTMENT`)
- **BUSINESS RULES:** BR-APT-11: só `kind=EXAM`; serializado com as marcações por bloqueio da linha do horário (sem overbooking sob concorrência); auditado (`CLINIC_SLOT_UPDATE`).

### `DELETE /clinic-portal/slots/{slotId}`  — removeClinicSlot
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Remover um horário livre.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `CONFLICT` (horário com marcações ativas), `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-04/BR-APT-11: só remove horários sem marcações ativas (consulta `REQUESTED`/`SCHEDULED`; exame `SCHEDULED`). M14 (BR-CLN-12): horário gerado por regra (`scheduleRuleId`) não se remove individualmente (`CONFLICT`); usar bloqueio/férias ou desativar a regra.

### M14 fases (a1)/(a2) — catálogo, regras de horário e bloqueios (ADR-026; contrato 2026-11-07)

> Tudo com `clinic_id` do token (404 sem enumeração, `authorization.md` §6.1). Sem DELETE nos recursos do catálogo e das regras: **desativa-se** (`active=false`). Retrocompatível: `POST /clinic-portal/slots` continua a funcionar sem `professionalId`/`serviceTypeId`.

### `GET /clinic-portal/professionals`  — listClinicProfessionals
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Listar profissionais (UC-CLN-11).
- **REQUEST:** Query `active?`
- **RESPONSE:** `200` `[ClinicProfessional]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-11.

### `POST /clinic-portal/professionals`  — createClinicProfessional
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Criar profissional.
- **REQUEST:** `ClinicProfessionalInput` (`name` 1–120, `specialty?` ≤80)
- **RESPONSE:** `201` `ClinicProfessional`
- **ERRORS:** `CONFLICT` (nome duplicado entre ativos; >100 profissionais), `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-11. Auditoria `CLINIC_PROFESSIONAL_CREATE`.

### `PATCH /clinic-portal/professionals/{professionalId}`  — updateClinicProfessional
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Alterar/desativar/reativar.
- **REQUEST:** `ClinicProfessionalPatch`
- **RESPONSE:** `200` `ClinicProfessional`
- **ERRORS:** `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-11/15: desativar remove os horários futuros livres gerados do profissional; marcações mantêm-se. Auditoria `CLINIC_PROFESSIONAL_UPDATE`.

### `GET /clinic-portal/services`  — listClinicServiceTypes
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Listar tipos de serviço (consulta/exame).
- **REQUEST:** Query `active?`, `kind?` (`APPOINTMENT`\|`EXAM`)
- **RESPONSE:** `200` `[ClinicServiceType]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-11/12.

### `POST /clinic-portal/services`  — createClinicServiceType
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Criar tipo de serviço.
- **REQUEST:** `ClinicServiceTypeInput` (`name`, `kind`, `durationMinutes` ∈ {15,20,30,45,60}, `priceMinor?` ≥0)
- **RESPONSE:** `201` `ClinicServiceType` (`currency` só leitura = moeda da clínica, AOA por omissão)
- **ERRORS:** `CONFLICT` (nome duplicado por `kind` entre ativos; >100 serviços), `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-12. Preço só informativo (não gera cobrança nem recibo). Auditoria `CLINIC_SERVICE_CREATE`.

### `PATCH /clinic-portal/services/{serviceTypeId}`  — updateClinicServiceType
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Alterar/desativar/reativar.
- **REQUEST:** `ClinicServiceTypePatch` (`kind` imutável)
- **RESPONSE:** `200` `ClinicServiceType`
- **ERRORS:** `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-12/15: mudar a duração só afeta horários a gerar; desativar remove os futuros livres gerados do serviço. Auditoria `CLINIC_SERVICE_UPDATE`.

### `GET /clinic-portal/schedule-rules`  — listClinicScheduleRules
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Listar regras de horário (UC-CLN-12).
- **REQUEST:** Query `professionalId?`, `active?`
- **RESPONSE:** `200` `[ClinicScheduleRule]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-12.

### `POST /clinic-portal/schedule-rules`  — createClinicScheduleRule
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Criar regra e gerar os horários das próximas 8 semanas.
- **REQUEST:** `ClinicScheduleRuleInput` (`professionalId`, `serviceTypeId`, `weekdays` ISO 1–7, `startTime`/`endTime` HH:mm locais, `validFrom?`, `validUntil?`, `capacity?`)
- **RESPONSE:** `201` `ClinicScheduleRuleResult` (`rule` + `generation`)
- **ERRORS:** `NOT_FOUND` (profissional/serviço de outra clínica), `CONFLICT` (inativos; regra sobreposta a outra ativa do profissional; >200 regras), `VALIDATION_ERROR` (intervalo sem espaço para uma duração; `capacity>1` em consulta), `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-12/13/14. Geração idempotente; sobreposições ignoradas e contadas, nunca apagam. Auditoria `CLINIC_SCHEDULE_RULE_CREATE` (+ contagens).

### `PATCH /clinic-portal/schedule-rules/{ruleId}`  — updateClinicScheduleRule
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Alterar/desativar/reativar e reconciliar.
- **REQUEST:** `ClinicScheduleRulePatch` (profissional e serviço imutáveis)
- **RESPONSE:** `200` `ClinicScheduleRuleResult`
- **ERRORS:** `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-12/15: remove os futuros livres que deixaram de corresponder; mantém os com marcações (`keptBooked`). Auditoria `CLINIC_SCHEDULE_RULE_UPDATE`.

### `POST /clinic-portal/schedule-rules/{ruleId}/regenerate`  — regenerateClinicScheduleRule
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Regenerar horários da regra (idempotente).
- **REQUEST:** —
- **RESPONSE:** `200` `ClinicScheduleRuleResult`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-12. Igual ao job `clinics.generate-schedule` para uma regra. Auditoria `CLINIC_SCHEDULE_RULE_REGENERATE`.

### `GET /clinic-portal/time-off`  — listClinicTimeOff
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Listar bloqueios/férias (UC-CLN-13).
- **REQUEST:** Query `professionalId?`, `from?`, `to?` (omissão: os que terminam depois de agora)
- **RESPONSE:** `200` `[ClinicTimeOff]` (com `bookedSlotCount`)
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-14.

### `POST /clinic-portal/time-off`  — createClinicTimeOff
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Bloquear um profissional num intervalo.
- **REQUEST:** `ClinicTimeOffInput` (`professionalId`, `startsAt`, `endsAt` > `startsAt`, ≤366 dias, futuro; `reason?` ≤200)
- **RESPONSE:** `201` `ClinicTimeOffResult` (`removedSlots`, `bookedSlots` a tratar)
- **ERRORS:** `NOT_FOUND`, `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-14: remove só horários **livres**; os com marcações ficam e são listados (a clínica reagenda/cancela pelos fluxos existentes). Auditoria `CLINIC_TIME_OFF_CREATE` (sem motivo).

### `DELETE /clinic-portal/time-off/{timeOffId}`  — deleteClinicTimeOff
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Remover um bloqueio e regenerar o intervalo.
- **REQUEST:** —
- **RESPONSE:** `200` `ClinicScheduleGeneration`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-14. Auditoria `CLINIC_TIME_OFF_DELETE`.

**Alterações a endpoints existentes (retrocompatíveis):** `POST /clinic-portal/slots` aceita `professionalId?`/`serviceTypeId?` (com `serviceTypeId`, `kind`/`specialty`/`durationMinutes` vêm do serviço; `specialty` e `durationMinutes` passam a obrigatórios só sem `serviceTypeId`) e devolve `CONFLICT`/`NOT_FOUND` por sobreposição/bloqueio/outra clínica (BR-CLN-13/14); `DELETE /clinic-portal/slots/{id}` devolve `CONFLICT` para horário gerado por regra (BR-CLN-12); `ClinicSlot` ganha `professionalId`, `serviceTypeId`, `scheduleRuleId` (nulos nos horários manuais); `POST /clinic-portal/walk-in-appointments` passa a detetar sobreposição por duração do paciente e do profissional (BR-CLN-13/16). Job `clinics.generate-schedule` (`modules.md` §5).

### `GET /clinic-portal/requests`  — listClinicRequests
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Listar pedidos (`REQUESTED`) por confirmar/recusar, só da própria clínica (UC-CLN-05).
- **REQUEST:** —
- **RESPONSE:** `200` `[ClinicBooking]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-03: só o mínimo necessário (nome do paciente, especialidade, profissional, data/hora, observações do pedido).

### `PUT /clinic-portal/requests/{appointmentId}`  — respondClinicRequest
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Confirmar ou recusar um pedido (UC-CLN-05).
- **REQUEST:** `ClinicRequestResponse`
- **RESPONSE:** `200` `ClinicBooking`
- **ERRORS:** `CONFLICT` (já respondido), `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-APT-06 (horário recusado volta a ficar livre); dispara `appointment.confirmed`/`appointment.rejected` (FR-APT-07, D17).

### `GET /clinic-portal/agenda`  — listClinicAgenda
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Listar as consultas confirmadas (`SCHEDULED`/`COMPLETED`/…) da própria clínica, por ordem cronológica (UC-CLN-06).
- **QUERY:** `from` (datetime), `to` (datetime)
- **REQUEST:** —
- **RESPONSE:** `200` `[ClinicBooking]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-03.

### `PUT /clinic-portal/agenda/{appointmentId}/cancel`  — cancelClinicAppointment
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Cancelar uma consulta confirmada e futura, com motivo obrigatório (UC-CLN-06).
- **REQUEST:** `ClinicCancelRequest`
- **RESPONSE:** `200` `ClinicBooking`
- **ERRORS:** `CONFLICT`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** Dispara `appointment.cancelled` (D17).

### `PUT /clinic-portal/agenda/{appointmentId}/complete`  — completeClinicAppointment
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Completar a consulta em curso: marcar `COMPLETED`, registar o resultado e, opcionalmente, emitir a receita (D18).
- **REQUEST:** `ClinicCompleteAppointmentRequest`
- **RESPONSE:** `200` `ClinicBooking`
- **ERRORS:** `CONFLICT` (consulta não está `SCHEDULED` ou já passou da janela, ST4), `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-06, BR-RX-07: a receita (se incluída) é criada no módulo `prescriptions` com `issuedBy=CLINIC` e `appointmentId` de origem, e passa a aparecer no histórico do paciente; a clínica só pode completar a consulta em curso que a própria clínica está a atender.

### `GET /clinic-portal/agenda/{appointmentId}/report`  — getClinicConsultationReport
- **AUTHORIZATION:** CLINIC_ACCOUNT (Admin e Gestor qualquer marcação; Médico as suas — `authorization.md` §6.2b)
- **DESCRIPTION:** Ver o relatório da consulta (rascunho ou final) de uma consulta Vita ou visita manual (UC-CLN-35, M15 S).
- **RESPONSE:** `200` `ConsultationReport`
- **ERRORS:** `NOT_FOUND` (inexistente, de outra clínica/profissional ou sem relatório), `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-41/44. A lista de marcações traz `reportStatus`. Leitura auditada (`CONSULT_REPORT_VIEWED`, sem texto).

### `PUT /clinic-portal/agenda/{appointmentId}/report`  — saveClinicConsultationReport
- **AUTHORIZATION:** `CLINIC_DOCTOR` (suas); Admin/Gestor ⇒ `FORBIDDEN`
- **DESCRIPTION:** Guardar (criar ou atualizar) o **rascunho** do relatório (UC-CLN-32).
- **REQUEST:** `ConsultationReportInput` (`reason?`, `findings?`, `impression?`, `plan?`, `sharedWithPatient?`)
- **RESPONSE:** `200` `ConsultationReport` (`status=DRAFT`)
- **ERRORS:** `FORBIDDEN`, `INVALID_STATE_TRANSITION` (relatório `FINAL` ou marcação cancelada/faltou/pedida), `NOT_FOUND`, `RATE_LIMITED` (60/min por conta), `UNAUTHENTICATED`, `VALIDATION_ERROR` (nenhuma secção, limites, caracteres de controlo)
- **BUSINESS RULES:** BR-CLN-41/42/44. Última escrita ganha. Marcação `SCHEDULED` ou `COMPLETED`. Auditoria `CONSULT_REPORT_SAVED` (sem texto).

### `PUT /clinic-portal/agenda/{appointmentId}/report/finalize`  — finalizeClinicConsultationReport
- **AUTHORIZATION:** `CLINIC_DOCTOR` (suas)
- **DESCRIPTION:** Finalizar o relatório (`DRAFT → FINAL`, imutável) numa consulta já concluída ou em curso (UC-CLN-33).
- **RESPONSE:** `200` `ConsultationReport`
- **ERRORS:** `FORBIDDEN`, `INVALID_STATE_TRANSITION`, `NOT_FOUND` (inclui sem relatório), `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-42/43. Idempotente. Fixa o retrato do perfil e `finalizedAt`. Auditoria `CONSULT_REPORT_FINALIZED`.

### `POST /clinic-portal/agenda/{appointmentId}/report/addenda`  — addClinicConsultationReportAddendum
- **AUTHORIZATION:** `CLINIC_DOCTOR` (suas)
- **DESCRIPTION:** Acrescentar adenda datada a um relatório `FINAL` (UC-CLN-34).
- **REQUEST:** `ConsultationReportAddendumInput` (`text` 1–1500)
- **RESPONSE:** `201` `ConsultationReport`
- **ERRORS:** `FORBIDDEN`, `INVALID_STATE_TRANSITION` (relatório `DRAFT`), `LIMIT_EXCEEDED` (20 adendas), `NOT_FOUND`, `RATE_LIMITED`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-43. Imutável. Auditoria `CONSULT_REPORT_AMENDED`.

### `GET /clinic-portal/agenda/{appointmentId}/report/pdf`  — getClinicConsultationReportPdf
- **AUTHORIZATION:** CLINIC_ACCOUNT (como `GET …/report`)
- **DESCRIPTION:** PDF imprimível gerado pelo sistema (UC-CLN-35).
- **RESPONSE:** `200` `application/pdf` (`Cache-Control: private, no-store`; `Content-Disposition: inline; filename="relatorio-AAAAMMDD.pdf"`)
- **ERRORS:** `NOT_FOUND`, `RATE_LIMITED` (30/min por conta), `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-46. Gerado a pedido (não guardado); `DRAFT` leva "RASCUNHO — sem valor". Auditoria `CONSULT_REPORT_VIEWED` (`format=PDF`).

**Alterações a endpoints existentes (retrocompatíveis, M15 S):** `PUT /clinic-portal/agenda/{id}/complete` aceita `report` (`ConsultationReportInput`; só `CLINIC_DOCTOR`, senão `FORBIDDEN`; grava e finaliza atomicamente); `ClinicBooking` (agenda, Hoje, ficha) ganha `reportStatus` (`DRAFT`\|`FINAL`\|nulo); `Appointment` (família) ganha `reportAvailable`.

### `POST /clinic-portal/patient-lookup`  — clinicPatientLookup
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Pesquisar um utilizador por e-mail exato para marcação presencial (UC-CLN-08, ADR-024).
- **REQUEST:** `{ email }` (e-mail válido, ≤254)
- **RESPONSE:** `200` `{ displayName }` (ex. `"Maria S."`; nenhum id)
- **ERRORS:** `NOT_FOUND` (genérico: inexistente, não `ACTIVE` ou sem membro `SELF`), `RATE_LIMITED`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-10, BR-CLN-03 (emenda D20). Só e-mail exato normalizado. Limites (propostos): 30 pedidos/h por conta (partilhado com o endpoint seguinte), 10 respostas 404/15 min por conta, 60/h por IP. Auditoria `CLINIC_WALKIN_LOOKUP`, sem e-mail.

### `POST /clinic-portal/walk-in-appointments`  — createClinicWalkInAppointment
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Marcar uma consulta presencial `SCHEDULED` para o utilizador num horário `APPOINTMENT` livre da própria clínica (UC-CLN-08, ADR-024).
- **REQUEST:** `{ patientEmail \| clinicPatientId, slotId, notes? }` (exatamente um dos dois primeiros; `notes` ≤2000; M14 P, BR-CLN-18)
- **RESPONSE:** `201` `ClinicBooking` (`status=SCHEDULED`; só o mínimo, BR-CLN-03)
- **ERRORS:** `NOT_FOUND` (horário de outra clínica/inexistente; paciente não resolvível, mesma resposta genérica), `CONFLICT` (horário ocupado ou passado; sobreposição **por duração** com consulta `SCHEDULED` do paciente ou, se o horário tem `professionalId`, com outra marcação ativa do profissional, BR-CLN-13/16), `VALIDATION_ERROR` (horário `kind=EXAM`; e-mail inválido; nenhum ou ambos de `patientEmail`/`clinicPatientId`), `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-10, BR-APT-04/06 (reserva o horário), BR-APT-03/07 (lembretes). Ordem de validação: horário da clínica → paciente → estado do horário → sobreposição. Auditoria `CLINIC_WALKIN_BOOK` (ou `CLINIC_VISIT_BOOK` na visita manual). **M14 P (BR-CLN-18):** `patientEmail` cria/liga o `ClinicPatient` e o consentimento `BOOKINGS`; `clinicPatientId` ligado a membro Vita marca no membro, sem ligação ⇒ visita manual (não aparece na app Vita). Alerta `APPOINTMENT_CONFIRMED` quando existir (OP-22).

### M14 fase (P) — pacientes da clínica, pesquisa e calendário (ADR-026; contrato 2026-11-08)

> Tudo com `clinic_id` do token (404 sem enumeração). Sem DELETE de pacientes nesta fase (retenção: OP-32). Nenhuma resposta contém ids Vita.

### `GET /clinic-portal/patients`  — listClinicPatients
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN` e `CLINIC_MANAGER`)
- **DESCRIPTION:** Listar/pesquisar os pacientes da própria clínica, paginado (UC-CLN-14).
- **REQUEST:** Query `q?` (2–100), `limit?` (1–100, 25), `cursor?`
- **RESPONSE:** `200` `ClinicPatientPage` (`items`, `nextCursor`)
- **ERRORS:** `VALIDATION_ERROR`, `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-17/22. `q` = nome (sem maiúsculas/acentos, contém), e-mail (contém) ou telefone (contém, ≥3 dígitos). Ordem por nome. Nunca pesquisa a base Vita. 60 pedidos/min por conta.

### `POST /clinic-portal/patients`  — createClinicPatient
- **AUTHORIZATION:** CLINIC_ACCOUNT (ambos)
- **DESCRIPTION:** Criar paciente da clínica (cliente de balcão sem conta Vita).
- **REQUEST:** `ClinicPatientInput` (`name` 1–120; `phone?`, `email?`, `birthDate?`, `notes?` ≤2000)
- **RESPONSE:** `201` `ClinicPatient` (`origin=MANUAL`, `vitaLink=null`)
- **ERRORS:** `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-17. Auditoria `CLINIC_PATIENT_CREATE` (sem dados pessoais).

### `GET /clinic-portal/patients/{patientId}`  — getClinicPatient
- **AUTHORIZATION:** CLINIC_ACCOUNT (ambos)
- **DESCRIPTION:** Ver um paciente.
- **RESPONSE:** `200` `ClinicPatient`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-17.

### `PATCH /clinic-portal/patients/{patientId}`  — updateClinicPatient
- **AUTHORIZATION:** CLINIC_ACCOUNT (ambos)
- **DESCRIPTION:** Editar (`null` limpa os campos opcionais; `origin` e `vitaLink` não se editam).
- **REQUEST:** `ClinicPatientPatch`
- **RESPONSE:** `200` `ClinicPatient`
- **ERRORS:** `NOT_FOUND`, `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-17. Auditoria `CLINIC_PATIENT_UPDATE` (nomes dos campos, sem valores).

### `GET /clinic-portal/patients/{patientId}/record`  — getClinicPatientRecord
- **AUTHORIZATION:** CLINIC_ACCOUNT (ambos)
- **DESCRIPTION:** Ficha: consultas (incl. visitas manuais), exames e recomendações **da própria clínica** com o paciente (UC-CLN-14).
- **RESPONSE:** `200` `ClinicPatientRecord` (até 200 itens de cada lista, mais recentes primeiro)
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-03/17. As marcações Vita associam-se ao paciente pela ligação (deixam de aparecer se for revogada); as visitas manuais mantêm-se. Estado do consentimento em `patient.vitaLink`.

### `GET /clinic-portal/patients/{patientId}/shared-history`  — getClinicSharedHistory
- **AUTHORIZATION:** CLINIC_ACCOUNT (ambos)
- **DESCRIPTION:** Medicação e exames partilhados pelo paciente Vita, só leitura (UC-CLN-17).
- **RESPONSE:** `200` `ClinicSharedHistory` (`active=false` e listas vazias sem consentimento `HISTORY` válido)
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-21. Medicação ativa; exames dos últimos 24 meses e futuros; sem documentos, notas nem texto livre; sem interpretação (D11). Auditoria `CLINIC_SHARED_HISTORY_VIEW` se `active`.

### `POST /clinic-portal/patients/link`  — linkClinicPatient
- **AUTHORIZATION:** CLINIC_ACCOUNT (ambos)
- **DESCRIPTION:** Ligar um paciente Vita com o código/QR gerado por ele (UC-CLN-15).
- **REQUEST:** `ClinicPatientLinkRequest` (`code`, `clinicPatientId?`)
- **RESPONSE:** `200` `ClinicPatient` (criado com `origin=VITA` ou o indicado, agora com `vitaLink`)
- **ERRORS:** `NOT_FOUND` (idêntico: inválido/expirado/usado; paciente de outra clínica), `CONFLICT`, `VALIDATION_ERROR`, `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-20, BR-CLN-10 (rate limit partilhado: 30/h por conta, 10 respostas 404/15 min, 60/h por IP). Cria consentimento `BOOKINGS` se não existir. Auditoria `CLINIC_PATIENT_LINK` (sem código).

### `GET /clinic-portal/search`  — clinicGlobalSearch
- **AUTHORIZATION:** CLINIC_ACCOUNT (ambos)
- **DESCRIPTION:** Pesquisa global do portal (UC-CLN-18).
- **REQUEST:** Query `q` (2–100)
- **RESPONSE:** `200` `ClinicSearchResult` (`patients` ≤10, `bookings` ≤10 `ClinicCalendarEntry`)
- **ERRORS:** `VALIDATION_ERROR`, `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-22. Só dados da própria clínica; nunca a base Vita. 60 pedidos/min por conta.

### `GET /clinic-portal/calendar`  — getClinicCalendar
- **AUTHORIZATION:** CLINIC_ACCOUNT (ambos)
- **DESCRIPTION:** Calendário por profissional (vista dia/semana) (UC-CLN-19).
- **REQUEST:** Query `from`, `to` (janela ≤ 31 dias), `professionalId?`
- **RESPONSE:** `200` `ClinicCalendar` (`entries`, `freeSlots`)
- **ERRORS:** `NOT_FOUND` (profissional de outra clínica), `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-23. O agrupamento por profissional faz-se no cliente com `professionalId` (nulo = "sem profissional").

**Alterações a endpoints existentes (retrocompatíveis):** `POST /clinic-portal/walk-in-appointments` aceita **exatamente um** de `patientEmail` e `clinicPatientId` (BR-CLN-18); com `patientEmail` cria/liga o paciente da clínica; com `clinicPatientId` de paciente sem ligação Vita cria uma **visita presencial manual** (`ClinicBooking.source=MANUAL`). `GET /clinic-portal/agenda` passa a incluir as visitas manuais; `PUT /clinic-portal/agenda/{id}/cancel` e `/complete` aceitam também o id de uma visita manual (completar: só `outcomeNote`; `prescription` ⇒ `VALIDATION_ERROR`). `ClinicBooking` ganha `source`, `clinicPatientId`, `slotId`. A ocupação de horários (BR-APT-06) conta também visitas manuais `SCHEDULED`.

### M14 fase (Q) — confirmação, fluxo do dia, indicadores e retorno (ADR-026; contrato 2026-11-08)

> Tudo com `clinic_id` do token (404 sem enumeração). `{appointmentId}` é o id de uma consulta Vita **ou** de uma visita manual (mesmo despacho de `cancel`/`complete`, BR-CLN-18). `AUTHORIZATION: CLINIC_ACCOUNT` (`CLINIC_ADMIN` e `CLINIC_MANAGER`). Resposta das ações: `200` `ClinicBooking`. Erros comuns: `NOT_FOUND`, `UNAUTHENTICATED`, `INVALID_STATE_TRANSITION`.

### `PUT /clinic-portal/agenda/{appointmentId}/confirm`  — confirmClinicAppointmentByPhone
- **DESCRIPTION:** "Confirmado por telefone" (consulta ou visita `SCHEDULED` e futura). Sem corpo.
- **BUSINESS RULES:** BR-CLN-27 (`CONFIRMED`, `confirmationSource=CLINIC`; a clínica nunca escreve `DECLINED`). Auditoria `CLINIC_APPOINTMENT_CONFIRM`/`CLINIC_VISIT_CONFIRM`.

### `PUT /clinic-portal/agenda/{appointmentId}/arrive`  — arriveClinicAppointment
- **DESCRIPTION:** "Chegou" (check-in). Sem corpo.
- **BUSINESS RULES:** BR-CLN-28. `SCHEDULED` ou `NO_SHOW`, no dia local da marcação; define `arrivedAt` (idempotente). Auditoria `CLINIC_APPOINTMENT_ARRIVE`/`CLINIC_VISIT_ARRIVE`.

### `PUT /clinic-portal/agenda/{appointmentId}/start`  — startClinicAppointment
- **DESCRIPTION:** "Iniciar" o atendimento. Sem corpo.
- **BUSINESS RULES:** BR-CLN-28. `SCHEDULED` no dia local; define `startedAt` (e `arrivedAt` se faltar). O estado Vita não muda. Auditoria `…_START`.

### `PUT /clinic-portal/agenda/{appointmentId}/no-show`  — noShowClinicAppointment
- **DESCRIPTION:** "Faltou". Sem corpo.
- **BUSINESS RULES:** BR-CLN-28. `SCHEDULED`, hora passada e sem `startedAt` ⇒ `NO_SHOW`. Auditoria `…_NO_SHOW`.
- **Concluir** continua a ser `PUT /clinic-portal/agenda/{id}/complete` (sem alterações; BR-CLN-06).

### `PUT /clinic-portal/agenda/{appointmentId}/follow-up`  — setClinicFollowUp
- **REQUEST:** `ClinicFollowUpRequest` (`{ amount: 1..24, unit: WEEKS\|MONTHS }`)
- **ERRORS:** `INVALID_STATE_TRANSITION` (não `COMPLETED`), `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-30. Auditoria `CLINIC_FOLLOWUP_SET`.

### `DELETE /clinic-portal/agenda/{appointmentId}/follow-up`  — clearClinicFollowUp
- **DESCRIPTION:** Limpa o retorno ("já tratado"); idempotente. Cancela o alerta ainda não emitido. `200` `ClinicBooking`. Auditoria `CLINIC_FOLLOWUP_CLEAR`.

### `GET /clinic-portal/follow-ups`  — listClinicFollowUps
- **REQUEST:** Query `until?` (data; omissão hoje + 14 dias)
- **RESPONSE:** `200` `[ClinicFollowUp]` (≤200, por `dueOn` crescente; retornos por tratar até `until`)
- **ERRORS:** `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-30. Sem ids Vita; `patientPhone` só do registo da clínica. Não auditado.

### `GET /clinic-portal/reports/summary`  — getClinicReportSummary
- **DESCRIPTION:** Indicadores simples (UC-CLN-24).
- **REQUEST:** Query `from`, `to` (datas locais inclusivas, ≤ 366 dias), `professionalId?`
- **RESPONSE:** `200` `ClinicReportSummary` (`totals`, `byProfessional`)
- **ERRORS:** `NOT_FOUND` (profissional de outra clínica), `VALIDATION_ERROR`, `RATE_LIMITED` (30/min por conta), `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-29. Só contagens e taxas; sem PII. Não auditado.

**Alterações a endpoints existentes (retrocompatíveis):** `ClinicBooking` e `ClinicCalendarEntry` ganham `confirmationStatus`, `dayState`, `arrivedAt`, `waitingMinutes` (e `ClinicBooking`: `confirmationSource`, `startedAt`, `followUpDueOn`); `GET /clinic-portal/calendar` e `/agenda` incluem as consultas `CANCELLED` com `confirmationStatus=DECLINED` (BR-CLN-23 emendada); `Appointment` (família) ganha `confirmationStatus` e `followUpDueOn`; `Alert.type` ganha `APPOINTMENT_CONFIRM_REQUEST` e `FOLLOWUP_REMINDER`; `clinic_visit_status` ganha `NO_SHOW` (visível em `ClinicBooking.status`).

### `GET /clinic-portal/receipts`  — listClinicReceipts
- **AUTHORIZATION:** CLINIC_ADMIN_MANAGER
- **DESCRIPTION:** Financeiro: recibos do período com o total (UC-CLN-27, M14 R).
- **QUERY:** `from`, `to` (datas locais inclusivas, obrigatórias, `to ≥ from`, ≤ 366 dias), `status?` (`ISSUED`\|`VOIDED`), `limit` (1–100, omissão 25), `cursor`
- **RESPONSE:** `200` `ClinicReceiptPage` (`items`, `nextCursor`, `summary`)
- **ERRORS:** `FORBIDDEN` (Médico), `RATE_LIMITED` (60/min por conta), `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-37. `summary` (`issuedCount`, `issuedTotalMinor`, `voidedCount`, `currency`) cobre o período inteiro; anulados não somam. Não auditado.

### `POST /clinic-portal/receipts`  — createClinicReceipt
- **AUTHORIZATION:** CLINIC_ADMIN_MANAGER
- **DESCRIPTION:** Emitir um recibo interno não fiscal para uma marcação concluída (UC-CLN-25).
- **REQUEST:** `ClinicReceiptInput` (`bookingKind`, `bookingId`, `paymentMethod`, `lines?`, `note?`)
- **RESPONSE:** `201` `ClinicReceipt`
- **ERRORS:** `CONFLICT` (já existe recibo `ISSUED` para a marcação), `FORBIDDEN`, `INVALID_STATE_TRANSITION` (marcação não `COMPLETED`), `NOT_FOUND` (marcação ou `serviceTypeId` de outra clínica/inexistente), `UNAUTHENTICATED`, `VALIDATION_ERROR` (linhas/valores, total 0, serviço sem preço, sem serviço no horário e sem `lines`)
- **BUSINESS RULES:** BR-CLN-31..35. Número sequencial atribuído na mesma transação (BR-CLN-32); retrato imutável; cria `clinic_receipt_links` se a marcação é Vita **e** há consentimento. Sem `Idempotency-Key` (fora do MVP): duplo envio ⇒ `CONFLICT`. Auditoria `CLINIC_RECEIPT_ISSUE`.

### `GET /clinic-portal/receipts/{receiptId}`  — getClinicReceipt
- **AUTHORIZATION:** CLINIC_ADMIN_MANAGER
- **DESCRIPTION:** Ver um recibo completo (a página Financeiro e a "Ficha" imprimem-no; o servidor não gera PDF, BR-CLN-37).
- **REQUEST:** —
- **RESPONSE:** `200` `ClinicReceipt`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-33/37. Não auditado.

### `POST /clinic-portal/receipts/{receiptId}/void`  — voidClinicReceipt
- **AUTHORIZATION:** CLINIC_ADMIN_MANAGER
- **DESCRIPTION:** Anular o recibo, com motivo (UC-CLN-26).
- **REQUEST:** `ClinicReceiptVoidRequest` (`reason` 3–200)
- **RESPONSE:** `200` `ClinicReceipt`
- **ERRORS:** `FORBIDDEN`, `INVALID_STATE_TRANSITION` (já anulado), `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-33: `ISSUED → VOIDED` irreversível; número mantido; o motivo é interno. Auditoria `CLINIC_RECEIPT_VOID` (sem o motivo).

### `GET /clinic-portal/profile`  — getClinicProfile
- **AUTHORIZATION:** CLINIC_ADMIN_MANAGER
- **DESCRIPTION:** Ver o perfil da própria clínica (UC-CLN-29).
- **REQUEST:** —
- **RESPONSE:** `200` `ClinicProfile`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-38. `name` e `currency` só leitura.

### `PATCH /clinic-portal/profile`  — updateClinicProfile
- **AUTHORIZATION:** CLINIC_ADMIN
- **DESCRIPTION:** Atualizar o perfil (parcial; `null` limpa).
- **REQUEST:** `ClinicProfileInput` (`displayName?`, `address?`, `phone?`, `email?`, `openingHours?`, `description?`)
- **RESPONSE:** `200` `ClinicProfile`
- **ERRORS:** `FORBIDDEN` (Gestor, Médico), `UNAUTHENTICATED`, `VALIDATION_ERROR` (limites, e-mail, corpo vazio, `name`/`currency`)
- **BUSINESS RULES:** BR-CLN-38: texto institucional sem dados de pacientes; passa a ser visível na app em `Clinic` (`displayName`, `description`, `openingHours`, `address`, `phone`, `email`). Auditoria `CLINIC_PROFILE_UPDATE` (nomes dos campos).

### `GET /clinic-portal/audit`  — listClinicAudit
- **AUTHORIZATION:** CLINIC_ADMIN
- **DESCRIPTION:** Auditoria da própria clínica: o que as contas da equipa fizeram e quando (UC-CLN-31).
- **QUERY:** `from?`, `to?` (instantes; janela ≤ 366 dias dentro da retenção de 24 meses), `action?`, `actorAccountId?`, `limit` (1–100, omissão 50), `cursor`
- **REQUEST:** —
- **RESPONSE:** `200` `ClinicAuditPage` (`items`: `id`, `occurredAt`, `action`, `resourceType`, `resourceId?`, `result`, `actorAccountId?`)
- **ERRORS:** `FORBIDDEN`, `RATE_LIMITED` (30/min por conta), `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-40 (exceção estreita a P7, `audit.md` §2 regra 4; ratificação em OP-42). Só ações de contas da clínica do token; nunca `ip`, `userAgent`, `requestId`, `metadata`, `familyId`, `subjectMemberId` nem e-mails. A leitura não se audita.

**Alterações a endpoints existentes (retrocompatíveis, M14 R):** `ClinicAccount`/`ClinicTokenResponse` ganham `role=CLINIC_DOCTOR` e `professionalId`; `ClinicStaffInput` ganha `role` e `professionalId`; `Clinic` ganha `displayName`, `description`, `openingHours` (listas de clínicas da família); `ClinicBooking`/`ClinicExamBooking` ganham `receiptId` (nunca para o Médico); `createReimbursementClaim` ganha `receiptIds` e `documentIds` deixa de ser obrigatório (1–10 itens no total, BR-CLN-36); `ReimbursementClaim` ganha `receipts` e `InsuranceClaimView` ganha `receipts` (resumo mínimo). As restantes rotas do portal mantêm o contrato, com o filtro/negação por papel de `authorization.md` §6.2b.

### `GET /clinic-portal/exam-agenda`  — listClinicExamAgenda
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Listar a agenda de exames (`SCHEDULED`/`COMPLETED`/`CANCELLED`) da própria clínica, por ordem cronológica (UC-CLN-09). Os exames nascem `SCHEDULED` (marcação direta da família); não há pedidos por confirmar.
- **QUERY:** `from` (datetime), `to` (datetime)
- **REQUEST:** —
- **RESPONSE:** `200` `[ClinicExamBooking]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-03.

### `PUT /clinic-portal/exam-agenda/{examinationId}/cancel`  — cancelClinicExamination
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Cancelar uma marcação de exame futura (`SCHEDULED`), com motivo obrigatório (UC-CLN-09).
- **REQUEST:** `ClinicCancelRequest`
- **RESPONSE:** `200` `ClinicExamBooking`
- **ERRORS:** `CONFLICT`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** `SCHEDULED → CANCELLED`; liberta uma vaga do horário (BR-APT-11); dispara `exam.cancelled`.

### `PUT /clinic-portal/exam-agenda/{examinationId}/complete`  — completeClinicExamination
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Completar o exame em curso: registar resultados estruturados (e/ou usar os PDF já carregados) (UC-CLN-10).
- **REQUEST:** `ClinicCompleteExaminationRequest`
- **RESPONSE:** `200` `ClinicExamBooking`
- **ERRORS:** `CONFLICT` (exame não está `SCHEDULED`), `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR` (sem resultados nem PDF)
- **BUSINESS RULES:** BR-CLN-08: `SCHEDULED → COMPLETED` atómico com os `ExamResult`; `issuedBy=CLINIC`, `issuedByClinicAccountId`, `resultsIssuedAt`; sem interpretação nem alertas por valor (D11); dispara `exam.results`; só exame da própria clínica.

### `GET /clinic-portal/exam-agenda/{examinationId}/results-draft`  — getClinicExamResultsDraft
- **AUTHORIZATION:** CLINIC_ACCOUNT (Admin, Gestor; Médico os seus)
- **DESCRIPTION:** Ver o rascunho de resultados de um exame `SCHEDULED` (UC-CLN-37, M15 T).
- **RESPONSE:** `200` `ClinicExamResultsDraft`
- **ERRORS:** `NOT_FOUND` (sem rascunho, exame de outra clínica/profissional), `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-47. Nunca visível ao paciente; valores fora de logs/auditoria.

### `PUT /clinic-portal/exam-agenda/{examinationId}/results-draft`  — saveClinicExamResultsDraft
- **AUTHORIZATION:** CLINIC_ACCOUNT (Admin, Gestor; Médico os seus)
- **DESCRIPTION:** Guardar (substituir) o rascunho sem concluir o exame.
- **REQUEST:** `ClinicExamResultsDraftInput` (`results?` 0–50, `resultNote?` ≤2000; ≥1 resultado ou nota)
- **RESPONSE:** `200` `ClinicExamResultsDraft`
- **ERRORS:** `INVALID_STATE_TRANSITION` (exame não `SCHEDULED`), `NOT_FOUND`, `RATE_LIMITED` (60/min por conta), `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-47. O exame continua `SCHEDULED`; não cria `exam_results`. Auditoria `EXAM_RESULTS_DRAFT_SAVED` (sem valores).

### `DELETE /clinic-portal/exam-agenda/{examinationId}/results-draft`  — discardClinicExamResultsDraft
- **AUTHORIZATION:** CLINIC_ACCOUNT (Admin, Gestor; Médico os seus)
- **DESCRIPTION:** Descartar o rascunho (idempotente).
- **RESPONSE:** `204`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-47. Auditoria `EXAM_RESULTS_DRAFT_DISCARDED`.

### `GET /clinic-portal/exam-agenda/{examinationId}/report/pdf`  — getClinicExamReportPdf
- **AUTHORIZATION:** CLINIC_ACCOUNT (Admin, Gestor; Médico os seus)
- **DESCRIPTION:** Descarregar o laudo PDF gerado pelo sistema, com o exame `COMPLETED` (UC-CLN-38).
- **RESPONSE:** `200` `application/pdf`
- **ERRORS:** `NOT_FOUND` (exame não concluído, sem laudo ou laudo apagado pelo titular), `RATE_LIMITED` (30/min por conta), `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-48/49: única exceção a "a clínica nunca descarrega" (BR-CLN-08). O paciente vê o mesmo documento pelas rotas de documentos de `EXAMS`. Auditoria `EXAM_REPORT_DOWNLOAD`.

**Alterações a endpoints existentes (retrocompatíveis, M15 T):** `PUT /clinic-portal/exam-agenda/{id}/complete` aceita `generateReport` (omissão `true`) e, sem `results` no corpo, usa o rascunho; `ClinicExamBooking` ganha `hasResultsDraft` e `reportAvailable`; `ClinicDocumentView` e `Document` ganham `generatedBySystem`.

### `POST /clinic-portal/exam-agenda/{examinationId}/documents`  — uploadClinicExamDocument
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Carregar um PDF de resultados num exame `SCHEDULED` da própria clínica (multipart).
- **REQUEST:** `ClinicExamDocumentUploadRequest` (multipart)
- **RESPONSE:** `201` `ClinicDocumentView`
- **ERRORS:** `CONFLICT` (exame não `SCHEDULED`; quota da família — sem detalhe), `DOCUMENT_LIMIT_EXCEEDED`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED` (só PDF), `NOT_FOUND`, `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-08, BR-DOC-01..04: quarentena + antivírus; a clínica nunca descarrega (só metadados); o paciente só vê o documento com o exame `COMPLETED`; auditado (`EXAM_DOCUMENT_UPLOAD`); `documents.uploaded_by_clinic_account_id`.

### `DELETE /clinic-portal/exam-agenda/{examinationId}/documents/{documentId}`  — deleteClinicExamDocument
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Remover um PDF carregado pela própria clínica enquanto o exame está `SCHEDULED`.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `CONFLICT` (exame já `COMPLETED`), `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-08; remoção definitiva (outbox de ficheiros).

### `GET /clinic-portal/recommendations`  — listClinicRecommendations
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Listar as recomendações emitidas pela própria clínica (UC-REC-02).
- **QUERY:** `appointmentId` (uuid), `examinationId` (uuid)
- **REQUEST:** —
- **RESPONSE:** `200` `[ClinicRecommendation]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-09: só as da própria clínica.

### `POST /clinic-portal/recommendations`  — createClinicRecommendation
- **AUTHORIZATION:** CLINIC_ACCOUNT
- **DESCRIPTION:** Emitir uma recomendação (nota de texto) sobre uma consulta ou um exame da própria clínica (UC-REC-01).
- **REQUEST:** `ClinicRecommendationInput`
- **RESPONSE:** `201` `ClinicRecommendation`
- **ERRORS:** `CONFLICT` (origem noutro estado), `NOT_FOUND` (origem de outra clínica/inexistente), `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-09: origem `SCHEDULED`/`COMPLETED`; 1–2000 caracteres; imutável (sem PUT/PATCH/DELETE); dispara `recommendation.added` (texto genérico); auditado (`RECOMMENDATION_CREATE`, sem o texto).

## Examinations

### `GET /families/{familyId}/members/{memberId}/examinations`  — listExaminations
- **AUTHORIZATION:** READ(EXAMS)
- **DESCRIPTION:** Listar exames.
- **QUERY:** `status` (string), `from` (date), `to` (date), `limit` (int), `cursor` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `{ items: [Examination], nextCursor }`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Dependente com conta não vê (N2).

### `POST /families/{familyId}/members/{memberId}/examinations`  — createExamination
- **AUTHORIZATION:** WRITE(EXAMS)
- **DESCRIPTION:** Registar exame privado/sem clínica (nasce `SCHEDULED`, ou `COMPLETED` se a data é passada). Para marcar num horário de clínica parceira, usar `slotId` em vez de `clinicId`/`clinicName`: havendo vaga, nasce `SCHEDULED` de imediato (BR-EXM-05, ADR-023 revisto 2026-11-04).
- **REQUEST:** `ExaminationInput`
- **RESPONSE:** `201` `Examination`
- **ERRORS:** `CONFLICT` (`slotId` sem vagas, removido, ou o membro já tem marcação ativa nesse horário), `FORBIDDEN`, `MEMBER_BLOCKED`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR` (inclui horário de `kind` errado, BR-APT-10)
- **BUSINESS RULES:** ST5: data passada nasce COMPLETED; futura nasce SCHEDULED com lembrete 24 h; com `slotId` nasce `SCHEDULED` (BR-EXM-05) com lembrete 24 h (BR-EXM-06; data/hora vêm do horário, exige `startsAt` futuro); a vaga é reservada atomicamente sob bloqueio do horário (BR-APT-11); o utilizador é avisado da minimização (BR-CLN-03) antes de enviar.

### `GET /families/{familyId}/members/{memberId}/examinations/{examinationId}`  — getExamination
- **AUTHORIZATION:** READ(EXAMS)
- **DESCRIPTION:** Ver exame com resultados.
- **REQUEST:** —
- **RESPONSE:** `200` `Examination`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PATCH /families/{familyId}/members/{memberId}/examinations/{examinationId}`  — updateExamination
- **AUTHORIZATION:** WRITE(EXAMS)
- **DESCRIPTION:** Alterar exame.
- **REQUEST:** `ExaminationPatch`
- **RESPONSE:** `200` `Examination`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** —

### `DELETE /families/{familyId}/members/{memberId}/examinations/{examinationId}`  — deleteExamination
- **AUTHORIZATION:** WRITE(EXAMS)
- **DESCRIPTION:** Eliminar exame, resultados e documentos.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PUT /families/{familyId}/members/{memberId}/examinations/{examinationId}/status`  — setExaminationStatus
- **AUTHORIZATION:** WRITE(EXAMS)
- **DESCRIPTION:** Marcar realizado, cancelado ou reagendar. `CANCELLED` num exame com `slotId` liberta a vaga (BR-APT-11); exame com `slotId` cancelado não se reagenda (`INVALID_STATE_TRANSITION`, BR-EXM-08). Não existem `REQUESTED`/`REJECTED` na API.
- **REQUEST:** `ExamStatusRequest`
- **RESPONSE:** `200` `Examination`
- **ERRORS:** `FORBIDDEN`, `INVALID_STATE_TRANSITION`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `POST /families/{familyId}/members/{memberId}/examinations/{examinationId}/results`  — addExamResult
- **AUTHORIZATION:** WRITE(EXAMS)
- **DESCRIPTION:** Adicionar resultado.
- **REQUEST:** `ExamResultInput`
- **RESPONSE:** `201` `ExamResult`
- **ERRORS:** `FORBIDDEN`, `INVALID_STATE_TRANSITION`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** D8, Q9, D11: sem interpretação nem alertas; só em exames COMPLETED (a clínica grava os seus resultados no ato de completar, BR-CLN-08).

### `PATCH /families/{familyId}/members/{memberId}/examinations/{examinationId}/results/{resultId}`  — updateExamResult
- **AUTHORIZATION:** WRITE(EXAMS)
- **DESCRIPTION:** Alterar resultado.
- **REQUEST:** `ExamResultPatch`
- **RESPONSE:** `200` `ExamResult`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** —

### `DELETE /families/{familyId}/members/{memberId}/examinations/{examinationId}/results/{resultId}`  — deleteExamResult
- **AUTHORIZATION:** WRITE(EXAMS)
- **DESCRIPTION:** Remover resultado.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `GET /families/{familyId}/members/{memberId}/exam-results`  — examResultHistory
- **AUTHORIZATION:** READ(EXAMS)
- **DESCRIPTION:** Histórico de um parâmetro ao longo do tempo.
- **QUERY:** `parameter` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `[ExamResultHistoryItem]`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** UC-EXM-04: devolve valores por data, sem gráficos nem interpretação.

## Recommendations (ADR-023)

### `GET /families/{familyId}/members/{memberId}/recommendations`  — listRecommendations
- **AUTHORIZATION:** READ(APPOINTMENTS) para as de consulta e READ(EXAMS) para as de exame (a lista **omite** as não permitidas)
- **DESCRIPTION:** Listar as recomendações recebidas de clínicas (UC-REC-03).
- **QUERY:** `appointmentId` (uuid), `examinationId` (uuid), `limit` (int), `cursor` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `{ items: [Recommendation], nextCursor }`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-09; dependente com conta só lê as de consulta (N2); leitura por quem não é o titular é auditada (`RECOMMENDATION_VIEW`); sem rota para escrever (só a clínica cria).

## Documents

### `POST /families/{familyId}/members/{memberId}/documents`  — uploadDocument
- **AUTHORIZATION:** WRITE(categoria do recurso)
- **DESCRIPTION:** Carregar documento de uma receita ou exame.
- **REQUEST:** `multipart/form-data → UploadDocumentRequest`
- **RESPONSE:** `201` `Document`
- **ERRORS:** `DOCUMENT_LIMIT_EXCEEDED`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `STORAGE_QUOTA_EXCEEDED`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** M5, N4, Q10: tipo verificado pelo conteúdo; nasce `PENDING` até o antivírus aprovar; 20 uploads/hora.

### `GET /families/{familyId}/members/{memberId}/documents`  — listDocuments
- **AUTHORIZATION:** READ(categoria do recurso)
- **DESCRIPTION:** Listar documentos de um recurso.
- **QUERY:** `resourceType` (string), `resourceId` (uuid)
- **REQUEST:** —
- **RESPONSE:** `200` `[Document]`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `GET /families/{familyId}/members/{memberId}/documents/{documentId}`  — getDocument
- **AUTHORIZATION:** READ(categoria do recurso)
- **DESCRIPTION:** Ver metadados do documento.
- **REQUEST:** —
- **RESPONSE:** `200` `Document`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `GET /families/{familyId}/members/{memberId}/documents/{documentId}/download`  — downloadDocument
- **AUTHORIZATION:** READ(categoria do recurso)
- **DESCRIPTION:** Descarregar documento (stream mediado).
- **REQUEST:** —
- **RESPONSE:** `200` ficheiro binário
- **ERRORS:** `DOCUMENT_NOT_AVAILABLE`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-DOC-04, ADR-006: autoriza, audita e entrega; `Cache-Control: private, no-store`; `Content-Disposition: attachment`.

### `DELETE /families/{familyId}/members/{memberId}/documents/{documentId}`  — deleteDocument
- **AUTHORIZATION:** WRITE(categoria do recurso)
- **DESCRIPTION:** Remover documento.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Apaga ficheiro via outbox.

## Insurance (ADR-021)

### `GET /families/{familyId}/insurers`  — listPartnerInsurers
- **AUTHORIZATION:** FAM_MEMBER
- **DESCRIPTION:** Listar as seguradoras parceiras `ACTIVE` (só id e nome), para escolher ao registar uma apólice (BR-INS-09).
- **REQUEST:** —
- **RESPONSE:** `200` `[PartnerInsurer]`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** ADR-023 (fecha lacuna de ADR-021): sem NIF nem contas.

### `GET /families/{familyId}/members/{memberId}/insurance-policies`  — listInsurancePolicies
- **AUTHORIZATION:** SELF/TUTOR_OF (seguro)
- **DESCRIPTION:** Listar apólices do membro.
- **REQUEST:** —
- **RESPONSE:** `200` `[InsurancePolicy]`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-INS-01/02; sem acesso de `OTHER`.

### `POST /families/{familyId}/members/{memberId}/insurance-policies`  — createInsurancePolicy
- **AUTHORIZATION:** SELF/TUTOR_OF (seguro)
- **DESCRIPTION:** Registar apólice (cartão); `insurerName` é texto livre.
- **REQUEST:** `InsurancePolicyInput`
- **RESPONSE:** `201` `InsurancePolicy`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-INS-01: não exige seguradora parceira.

### `GET /families/{familyId}/members/{memberId}/insurance-policies/{policyId}`  — getInsurancePolicy
- **AUTHORIZATION:** SELF/TUTOR_OF (seguro)
- **DESCRIPTION:** Ver apólice.
- **REQUEST:** —
- **RESPONSE:** `200` `InsurancePolicy`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PATCH /families/{familyId}/members/{memberId}/insurance-policies/{policyId}`  — updateInsurancePolicy
- **AUTHORIZATION:** SELF/TUTOR_OF (seguro)
- **DESCRIPTION:** Editar apólice.
- **REQUEST:** `InsurancePolicyPatch`
- **RESPONSE:** `200` `InsurancePolicy`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** —

### `DELETE /families/{familyId}/members/{memberId}/insurance-policies/{policyId}`  — deleteInsurancePolicy
- **AUTHORIZATION:** SELF/TUTOR_OF (seguro)
- **DESCRIPTION:** Eliminar apólice.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `CONFLICT`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Recusa se existir `ReimbursementClaim` `SUBMITTED`/`APPROVED`.

### `GET /families/{familyId}/members/{memberId}/insurance-policies/{policyId}/reimbursement-claims`  — listReimbursementClaims
- **AUTHORIZATION:** SELF/TUTOR_OF (seguro)
- **DESCRIPTION:** Listar pedidos de reembolso da apólice.
- **REQUEST:** —
- **RESPONSE:** `200` `[ReimbursementClaim]`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `POST /families/{familyId}/members/{memberId}/insurance-policies/{policyId}/reimbursement-claims`  — createReimbursementClaim
- **AUTHORIZATION:** SELF/TUTOR_OF (seguro)
- **DESCRIPTION:** Submeter pedido de reembolso.
- **REQUEST:** `ReimbursementClaimInput`
- **RESPONSE:** `201` `ReimbursementClaim`
- **ERRORS:** `NOT_FOUND` (apólice sem seguradora parceira), `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-INS-03/04: só sobre apólice de seguradora parceira; `documentIds` escolhidos pelo titular entre documentos já carregados.

### `GET /families/{familyId}/members/{memberId}/insurance-policies/{policyId}/reimbursement-claims/{claimId}`  — getReimbursementClaim
- **AUTHORIZATION:** SELF/TUTOR_OF (seguro)
- **DESCRIPTION:** Ver pedido de reembolso.
- **REQUEST:** —
- **RESPONSE:** `200` `ReimbursementClaim`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `PUT /families/{familyId}/members/{memberId}/insurance-policies/{policyId}/reimbursement-claims/{claimId}/paid`  — markReimbursementClaimPaid
- **AUTHORIZATION:** SELF/TUTOR_OF (seguro)
- **DESCRIPTION:** Confirmar receção do pagamento.
- **REQUEST:** —
- **RESPONSE:** `200` `ReimbursementClaim`
- **ERRORS:** `CONFLICT`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-INS-05: `APPROVED → PAID`, só pelo titular/tutor nesta versão (fora do MVP: o portal marcar `PAID`).

## Insurance Portal (`/insurance-portal/*`, ADR-021)

> Autenticação por `insuranceAccessToken` (ver topo do documento), **nunca** `Authorization: Bearer` de User ou de clínica. Nenhuma rota aqui aceita `familyId`/`memberId`; o recurso é sempre resolvido pela seguradora do token (§8.1 de `authorization.md`). Minimização: o portal nunca devolve condições, alergias, medicação, consultas, exames, nem dados de família/tutela — só os campos de `InsuranceClaimView` e os documentos escolhidos pelo titular para o pedido (BR-INS-04).

### `POST /insurance-portal/auth/login`  — insuranceLogin
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Iniciar sessão de uma conta do portal da seguradora.
- **REQUEST:** `InsuranceLoginRequest`
- **RESPONSE:** `200` `InsuranceTokenResponse`
- **ERRORS:** `AUTH_INVALID_CREDENTIALS`, `ACCOUNT_SUSPENDED`, `RATE_LIMITED`
- **BUSINESS RULES:** Define cookie `insurance_refresh_token` (HttpOnly, Secure, SameSite=Strict, caminho `/api/v1/insurance-portal/auth`), independente dos cookies de User/`ClinicAccount` (ADR-021). Audita sucesso e falha.

### `POST /insurance-portal/auth/refresh`  — insuranceRefreshToken
- **AUTHORIZATION:** PUBLIC (cookie)
- **DESCRIPTION:** Rodar refresh token e obter novo access token.
- **REQUEST:** —
- **RESPONSE:** `200` `InsuranceTokenResponse`
- **ERRORS:** `UNAUTHENTICATED`, `ACCOUNT_SUSPENDED`, `RATE_LIMITED`
- **BUSINESS RULES:** Mesma política de rotação/reutilização de `/auth/refresh`, em `insurance_sessions`.

### `POST /insurance-portal/auth/logout`  — insuranceLogout
- **AUTHORIZATION:** INSURANCE_ACCOUNT
- **DESCRIPTION:** Terminar sessão atual do portal.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `GET /insurance-portal/agents`  — listInsuranceAgents
- **AUTHORIZATION:** INSURANCE_ADMIN
- **DESCRIPTION:** Listar as contas `INSURANCE_AGENT` da própria seguradora.
- **REQUEST:** —
- **RESPONSE:** `200` `[InsuranceAccount]`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-INS-06.

### `POST /insurance-portal/agents`  — createInsuranceAgent
- **AUTHORIZATION:** INSURANCE_ADMIN
- **DESCRIPTION:** Criar conta `INSURANCE_AGENT` na própria seguradora.
- **REQUEST:** `InsuranceAgentInput`
- **RESPONSE:** `201` `InsuranceAccount`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-INS-06: self-service; o Platform Admin nunca cria agentes individualmente.

### `DELETE /insurance-portal/agents/{insuranceAccountId}`  — removeInsuranceAgent
- **AUTHORIZATION:** INSURANCE_ADMIN
- **DESCRIPTION:** Remover conta `INSURANCE_AGENT` da própria seguradora.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** Só remove `INSURANCE_AGENT`; a conta `INSURANCE_ADMIN` raiz só é reposta pelo Platform Admin (`POST /admin/insurers/{id}/root-account`).

### `GET /insurance-portal/claims`  — listInsuranceClaims
- **AUTHORIZATION:** INSURANCE_ACCOUNT
- **DESCRIPTION:** Listar pedidos de reembolso, só da própria seguradora.
- **QUERY:** `status` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `[InsuranceClaimView]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `GET /insurance-portal/claims/{claimId}`  — getInsuranceClaim
- **AUTHORIZATION:** INSURANCE_ACCOUNT
- **DESCRIPTION:** Abrir um pedido, com os documentos anexados.
- **REQUEST:** —
- **RESPONSE:** `200` `InsuranceClaimView`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-INS-04: só os documentos escolhidos pelo titular para este pedido.

### `PUT /insurance-portal/claims/{claimId}/decide`  — decideInsuranceClaim
- **AUTHORIZATION:** INSURANCE_ACCOUNT
- **DESCRIPTION:** Aprovar ou rejeitar um pedido.
- **REQUEST:** `InsuranceClaimDecisionRequest`
- **RESPONSE:** `200` `InsuranceClaimView`
- **ERRORS:** `CONFLICT`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-INS-05: `SUBMITTED → APPROVED|REJECTED`; `REJECTED` exige motivo.

## Seguradoras — módulo operacional (ADR-025) — ESBOÇO, NÃO CONTRATUAL

> **Pendência explícita:** estas rotas **não existem em `openapi.yaml`** (não foi alterado por este change control) e **não podem ser implementadas** até o contrato ser redigido e validado no marco S1 (`vita-architect` + `vita-identity`). Prefixos, papéis e nomes são propostos; o contrato final prevalece. Base `/api/v1`; erros, paginação e `Idempotency-Key` (nas submissões da clínica) como `errors.md`/`api-overview.md`. Tokens: `/insurance-portal/*` com o `insuranceAccessToken`; `/clinic-portal/*` com o `clinicAccessToken`; `/families/...` com o token de User. Autorização: `authorization.md` §8.2b (seguradora), §8.4 (clínica), §8.5 (paciente). Respostas de `insurerId` diferente do do token ⇒ `NOT_FOUND`.

### Portal da seguradora (`/insurance-portal/*`; papéis na coluna Quem)
| Método e caminho | Quem | Descrição | UC / BR |
|---|---|---|---|
| `GET/POST /insurance-portal/companies`, `PATCH .../companies/{id}` | ADMIN, BENEFICIARY_MGR (escrita); restantes R | Empresas. | UC-SEG-01 |
| `GET/POST /insurance-portal/beneficiaries`, `GET/PATCH .../{id}`, `POST .../{id}/status` | BENEFICIARY_MGR, ADMIN (escrita) | Beneficiários e dependentes; estado `PENDING→ACTIVE⇄SUSPENDED→CANCELLED`. | UC-SEG-02, BR-SEG-17 |
| `POST /insurance-portal/imports` (multipart CSV/XLSX), `GET .../imports/{id}` (pré-visualização + erros por linha), `POST .../imports/{id}/commit`, `DELETE .../imports/{id}` | BENEFICIARY_MGR, ADMIN | Importação até 5.000 linhas. | BR-SEG-17 |
| `GET /insurance-portal/link-requests`, `POST .../link-requests/{id}/confirm\|reject` | BENEFICIARY_MGR, ADMIN | Confirmar ligação paciente↔beneficiário. | BR-SEG-20 |
| `GET/POST /insurance-portal/policies`, `GET/PATCH .../{id}`, `POST .../{id}/status` | BENEFICIARY_MGR, ADMIN | Apólices. | UC-SEG-03 |
| `GET/POST /insurance-portal/plans`, `GET/PATCH .../{id}`, `POST .../{id}/status`, `POST .../{id}/new-version`, `GET/PUT .../{id}/coverages` | ADMIN (escrita); restantes R | Planos e coberturas. | UC-SEG-04 |
| `GET/POST /insurance-portal/services`, `PATCH .../services/{id}` | ADMIN | Lista de serviços da seguradora. | BR-SEG-22 |
| `GET/POST /insurance-portal/providers`, `GET/PATCH .../{id}`, `POST .../{id}/status`, `PUT .../{id}/services` | ADMIN (escrita) | Rede de prestadores, unidades, ligação à clínica. | UC-SEG-09 |
| `GET /insurance-portal/authorizations`, `GET .../{id}`, `POST .../{id}/decide` (`APPROVE\|REJECT\|REQUEST_INFO\|CANCEL`) | AUTH_ANALYST (decide); ADMIN/CLAIMS/FINANCE R | Análise de autorizações. | UC-SEG-07 |
| `GET /insurance-portal/expenses`, `GET .../{id}`, `POST .../{id}/decide` (`APPROVE\|REJECT\|RETURN`) | CLAIMS_MGR (decide); restantes R | Análise de despesas. | UC-SEG-12 |
| `GET /insurance-portal/dashboard` | todos (conteúdo por papel) | Indicadores agregados no servidor. | UC-SEG-16 |
| `GET /insurance-portal/audit` | ADMIN | Auditoria da seguradora (ver pendência de `audit.md`). | UC-SEG-17 |
| `GET/POST/DELETE /insurance-portal/agents` (existente, ADR-021) | ADMIN | Alargar a criação de contas aos quatro papéis novos (campo `role`). | `authorization.md` §8.3 |

### Portal da clínica (`/clinic-portal/insurers/*`; `CLINIC_ADMIN`/`CLINIC_MANAGER`)
| Método e caminho | Descrição | UC / BR |
|---|---|---|
| `GET /clinic-portal/insurers` | Seguradoras a que a clínica está ligada (a do cartão apresentado — Q4 pendente). | BR-SEG-23 |
| `POST /clinic-portal/insurers/{insurerId}/eligibility` | Validar (nº cartão, QR ou identificação, `serviceCode?`); resposta mínima; auditada; rate limit. | UC-SEG-05, BR-SEG-18 |
| `GET /clinic-portal/insurers/{insurerId}/services` | Lista de serviços da seguradora. | BR-SEG-22 |
| `POST /clinic-portal/insurers/{insurerId}/encounters` | Registar atendimento (sem diagnóstico). | UC-SEG-10 |
| `POST/GET /clinic-portal/insurers/{insurerId}/authorizations`, `GET .../{id}`, `POST .../{id}/respond` (resposta a `INFO_REQUESTED`), `POST .../{id}/cancel` | Autorizações. | UC-SEG-06/08 |
| `POST/GET /clinic-portal/insurers/{insurerId}/expenses`, `GET/PATCH .../{id}` (`PATCH` só em `RETURNED`) | Despesas. | UC-SEG-11/13 |
| `POST .../authorizations/{id}/attachments`, `POST .../expenses/{id}/attachments` | Anexos (pendência de desenho, ADR-025). | `insurer_attachments` |

### App do paciente (`/families/{familyId}/members/{memberId}/insurance/*`; `SELF`/`TUTOR_OF`)
| Método e caminho | Descrição | UC / BR |
|---|---|---|
| `POST .../insurance/card-claims` | Reclamar o cartão (nº de apólice + código da seguradora) — consentimento. | BR-SEG-20 |
| `DELETE .../insurance/card-claims/{id}` | Desligar. | BR-SEG-20 |
| `GET .../insurance/cards` , `GET .../insurance/cards/{beneficiaryId}/qr` | Cartões digitais (um por seguradora) e QR rotativo. | UC-SEG-15 |
| `GET .../insurance/cards/{beneficiaryId}/coverage-balance` | Plano, coberturas, limites e saldo. | UC-SEG-14 |
| `GET .../insurance/cards/{beneficiaryId}/authorizations`, `.../expenses` | Histórico com valores comparticipados. | UC-SEG-15 |

Alterações a rotas existentes (a incluir no contrato): `POST /admin/insurers`/`PATCH /admin/insurers/{id}` ganham `currency` e `operationalModuleEnabled`; `createReimbursementClaim` ganha `encounterId?` e passa a ler a moeda da seguradora (sem `EUR` fixo).

## Alerts

### `GET /alerts`  — listAlerts
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Listar os meus alertas.
- **QUERY:** `unread` (bool), `limit` (int), `cursor` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `{ items: [Alert], nextCursor }`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** UC-ALR-03: só alertas de que sou destinatário; não lidos primeiro.

### `POST /alerts/{alertId}/read`  — markAlertRead
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Marcar alerta como lido.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `POST /alerts/read-all`  — markAllAlertsRead
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Marcar todos como lidos.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** —

## Reports

### `GET /families/{familyId}/members/{memberId}/report`  — memberReport
- **AUTHORIZATION:** READ (por secção)
- **DESCRIPTION:** Relatório individual.
- **QUERY:** `from` (date), `to` (date)
- **REQUEST:** —
- **RESPONSE:** `200` `MemberReport`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** FR-RPT-01, Q11: período por defeito 12 meses (máx. 5 anos); secções sem permissão **omitidas**; audita.

### `GET /families/{familyId}/report`  — familyReport
- **AUTHORIZATION:** FAM_MEMBER
- **DESCRIPTION:** Visão familiar.
- **REQUEST:** —
- **RESPONSE:** `200` `FamilyReport`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** FR-RPT-02/03: só o que o pedinte pode ver; Admin não vê mais por ser Admin.

### `GET /families/{familyId}/members/{memberId}/medication-adherence`  — medicationAdherence
- **AUTHORIZATION:** READ(MEDICATION)
- **DESCRIPTION:** Resumo de adesão à medicação.
- **QUERY:** `from` (date), `to` (date)
- **REQUEST:** —
- **RESPONSE:** `200` `[AdherenceItem]`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** UC-RPT-03: só contagens por estado, sem interpretação.

## Admin

### `GET /admin/users`  — adminListUsers
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Listar contas.
- **QUERY:** `q` (string, mín. 2; e-mail ou nome, BR-ADM-01), `status` (string), `limit` (int), `cursor` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `{ items: [AdminUser], nextCursor }`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** D4/R10: nunca devolve dados de saúde.

### `GET /admin/users/{userId}`  — adminGetUser
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Detalhe operacional de um utilizador (UC-ADM-04).
- **REQUEST:** —
- **RESPONSE:** `200` `AdminUserDetail`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-ADM-01, D4/R10: nunca dados de saúde, famílias ou membros.

### `POST /admin/users/{userId}/reset-access`  — adminResetUserAccess
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Repor o acesso: revoga todas as sessões e envia ao utilizador o e-mail de recuperação (UC-ADM-05).
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN` (inclui a si próprio), `NOT_FOUND`, `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-ADM-02: token de uso único (1 h) nunca devolvido; `PENDING_VERIFICATION` recebe nova verificação; auditado (`ADMIN_USER_RESET_ACCESS`).

### `POST /admin/users/{userId}/suspend`  — adminSuspendUser
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Suspender conta.
- **REQUEST:** `SuspendRequest`
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-ACC-05; revoga sessões; auditado.

### `POST /admin/users/{userId}/reactivate`  — adminReactivateUser
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Reativar conta.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `GET /admin/clinics`  — adminListClinics
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Listar clínicas parceiras.
- **REQUEST:** —
- **RESPONSE:** `200` `[Clinic]`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

### `POST /admin/clinics`  — adminCreateClinic
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Criar clínica parceira.
- **REQUEST:** `ClinicInput`
- **RESPONSE:** `201` `Clinic`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** R8.

### `PATCH /admin/clinics/{clinicId}`  — adminUpdateClinic
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Alterar clínica parceira.
- **REQUEST:** `ClinicPatch`
- **RESPONSE:** `200` `Clinic`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** —

### `PUT /admin/clinics/{clinicId}/status`  — adminSetClinicStatus
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Arquivar/reativar clínica parceira.
- **REQUEST:** `ClinicStatusRequest`
- **RESPONSE:** `200` `Clinic`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR: arquivar não apaga consultas existentes.

### `GET /admin/clinics/{clinicId}/accounts`  — adminListClinicAccounts
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Listar as contas do portal de uma clínica parceira (UC-ADM-06).
- **REQUEST:** —
- **RESPONSE:** `200` `[AdminClinicAccount]`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-ADM-03 (emenda ADR-020): só identificação e estado; não cria nem remove Gestores (BR-CLN-05).

### `POST /admin/clinics/{clinicId}/accounts/{clinicAccountId}/suspend`  — adminSuspendClinicAccount
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Suspender uma conta do portal da clínica.
- **REQUEST:** `SuspendRequest`
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-ADM-04: revoga `clinic_sessions` de imediato; login ⇒ `ACCOUNT_SUSPENDED`; auditado (`ADMIN_CLINIC_ACCOUNT_SUSPEND`).

### `POST /admin/clinics/{clinicId}/accounts/{clinicAccountId}/reactivate`  — adminReactivateClinicAccount
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Reativar uma conta do portal da clínica.
- **REQUEST:** —
- **RESPONSE:** `204` sem corpo
- **ERRORS:** `CONFLICT` (já existe `CLINIC_ADMIN` ativo), `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-ADM-04; auditado (`ADMIN_CLINIC_ACCOUNT_REACTIVATE`).

### `POST /admin/clinics/{clinicId}/root-account`  — adminCreateOrResetClinicRootAccount
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Criar a conta `CLINIC_ADMIN` raiz de uma clínica parceira (ao criar a clínica) ou repor as suas credenciais (perda de acesso, D18).
- **REQUEST:** `ClinicRootAccountRequest`
- **RESPONSE:** `200` `ClinicAccount`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-05: única via do Platform Admin para o portal da clínica; não cria nem lista `CLINIC_MANAGER`. Idempotente por clínica (repor substitui a credencial da conta `CLINIC_ADMIN` existente, nunca cria uma segunda).

### `GET /admin/insurers`  — adminListInsurers
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Listar seguradoras parceiras.
- **REQUEST:** —
- **RESPONSE:** `200` `[Insurer]`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** ADR-021 (mirror de `adminListClinics`).

### `POST /admin/insurers`  — adminCreateInsurer
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Criar seguradora parceira.
- **REQUEST:** `InsurerInput`
- **RESPONSE:** `201` `Insurer`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** ADR-021.

### `PATCH /admin/insurers/{insurerId}`  — adminUpdateInsurer
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Editar seguradora parceira (nome e/ou NIF).
- **REQUEST:** `InsurerPatch`
- **RESPONSE:** `200` `Insurer`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR` (inclui NIF duplicado)
- **BUSINESS RULES:** BR-ADM-05 (completa ADR-021); auditado (`ADMIN_INSURER_UPDATE`); sem eliminação.

### `PUT /admin/insurers/{insurerId}/status`  — adminSetInsurerStatus
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Suspender/reativar seguradora parceira.
- **REQUEST:** `InsurerStatusRequest`
- **RESPONSE:** `200` `Insurer`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** ADR-021 (mirror de `adminSetClinicStatus`); BR-INS-10: suspender revoga `insurance_sessions` e bloqueia novos pedidos.

### `POST /admin/insurers/{insurerId}/root-account`  — adminCreateOrResetInsurerRootAccount
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Criar a conta `INSURANCE_ADMIN` raiz de uma seguradora parceira (ao criar a seguradora) ou repor as suas credenciais.
- **REQUEST:** `InsurerRootAccountRequest`
- **RESPONSE:** `200` `InsuranceAccount`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-INS-06: única via do Platform Admin para o portal da seguradora; não cria nem lista `INSURANCE_AGENT`. Idempotente por seguradora.

## Operations

### `GET /health`  — healthLive
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Liveness.
- **REQUEST:** —
- **RESPONSE:** `200` `HealthStatus`
- **ERRORS:** —
- **BUSINESS RULES:** —

### `GET /health/ready`  — healthReady
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Readiness (BD, Redis, armazenamento).
- **REQUEST:** —
- **RESPONSE:** `200` `HealthStatus`
- **ERRORS:** —
- **BUSINESS RULES:** —

## Schemas

**Message** — `message`: string

**Problem** — `type`: string, `title`: string, `status`: int, `code`: string, `detail?`: string, `requestId`: string, `errors?`: [FieldError]

**FieldError** — `field`: string, `message`: string

**RegisterRequest** — `email`: email, `password`: string, `name`: string, `birthDate`: date, `timezone`: string, `termsVersion`: string, `invitationToken?`: string

**VerifyEmailRequest** — `token`: string

**ResendVerificationRequest** — `email`: email

**LoginRequest** — `email`: email, `password`: string

**TokenResponse** — `accessToken`: string, `expiresIn`: int

**ForgotPasswordRequest** — `email`: email

**ResetPasswordRequest** — `token`: string, `newPassword`: string

**ChangePasswordRequest** — `currentPassword`: string, `newPassword`: string

**User** — `id`: uuid, `email`: email, `name`: string, `birthDate`: date, `timezone`: string, `status`: PENDING_VERIFICATION|ACTIVE|SUSPENDED, `platformRole`: NONE|PLATFORM_ADMIN, `termsAcceptedVersion`: string, `termsReacceptanceRequired`: bool, `createdAt`: datetime

**UpdateUserRequest** — `name?`: string, `timezone?`: string

**DeleteAccountRequest** — `password`: string

**AcceptTermsRequest** — `termsVersion`: string

**NotificationPreferences** — `pushEnabled`: bool, `emailEnabled`: bool, `medicationDue`: bool, `appointmentReminder`: bool, `examReminder`: bool

**PushSubscriptionRequest** — `endpoint`: string, `p256dh`: string, `auth`: string, `userAgent?`: string

**PushSubscription** — `id`: uuid, `endpoint`: string, `createdAt`: datetime

**DataExport** — `id`: uuid, `status`: PENDING|READY|EXPIRED|FAILED, `reason`: USER_REQUEST|LEAVE_FAMILY|REMOVED_BY_ADMIN, `requestedAt`: datetime, `expiresAt?`: datetime

**Family** — `id`: uuid, `name`: string, `myRole`: FAMILY_ADMIN|FAMILY_MEMBER, `createdAt`: datetime

**CreateFamilyRequest** — `name`: string

**UpdateFamilyRequest** — `name`: string

**LeaveFamilyRequest** — `dataChoice`: TAKE|DELETE

**LeaveFamilyResult** — `dataExportId?`: uuid

**Member** — `id`: uuid, `familyId`: uuid, `name`: string, `birthDate`: date, `isMinor`: bool, `isDependent`: bool, `hasAccount`: bool, `role?`: FAMILY_ADMIN|FAMILY_MEMBER, `status`: ACTIVE|BLOCKED, `isSelf`: bool, `primaryGuardianId?`: uuid, `guardianIds`: [uuid], `scheduledDeletionAt?`: datetime

**CreateMemberRequest** — `name`: string, `birthDate`: date, `isDependent`: bool, `guardianMemberIds?`: [uuid], `primaryGuardianMemberId?`: uuid

**UpdateMemberRequest** — `name?`: string, `birthDate?`: date

**SetRoleRequest** — `role`: FAMILY_ADMIN|FAMILY_MEMBER

**SetDependentRequest** — `isDependent`: bool, `guardianMemberIds?`: [uuid], `primaryGuardianMemberId?`: uuid

**Guardianship** — `dependentId`: uuid, `guardianId`: uuid, `isPrimary`: bool

**AddGuardianRequest** — `guardianMemberId`: uuid, `isPrimary?`: bool

**SetPrimaryGuardianRequest** — `guardianMemberId`: uuid

**Invitation** — `id`: uuid, `familyId`: uuid, `email`: email, `type`: MEMBER|DEPENDENT_ACCOUNT, `status`: PENDING|ACCEPTED|REVOKED|EXPIRED, `expiresAt`: datetime, `memberId?`: uuid

**CreateInvitationRequest** — `email`: email, `memberId?`: uuid

**CreateDependentAccountInvitationRequest** — `email`: email

**InvitationLookupRequest** — `token`: string

**InvitationPreview** — `familyName`: string, `invitedEmail`: email, `type`: MEMBER|DEPENDENT_ACCOUNT, `expiresAt`: datetime

**AcceptInvitationRequest** — `token`: string

**SharingGrant** — `category`: ALLERGIES|CONDITIONS|MEDICATION|APPOINTMENTS|EXAMS, `granteeMemberId?`: uuid

**SharingSettings** — `grants`: [SharingGrant]

**SharedWithMeItem** — `memberId`: uuid, `memberName`: string, `categories`: [string]

**BloodType** — `bloodType`: A_POS|A_NEG|B_POS|B_NEG|AB_POS|AB_NEG|O_POS|O_NEG|UNKNOWN

**Allergy** — `id`: uuid, `name`: string, `notes?`: string, `since?`: date

**AllergyInput** — `name`: string, `notes?`: string, `since?`: date

**AllergyPatch** — `name?`: string, `notes?`: string, `since?`: date

**Condition** — `id`: uuid, `name`: string, `kind`: CONDITION|HISTORY, `notes?`: string, `since?`: date, `until?`: date

**ConditionInput** — `name`: string, `kind`: CONDITION|HISTORY, `notes?`: string, `since?`: date, `until?`: date

**ConditionPatch** — `name?`: string, `kind?`: CONDITION|HISTORY, `notes?`: string, `since?`: date, `until?`: date

**MedicationPlan** — `id`: uuid, `memberId`: uuid, `prescriptionId?`: uuid, `name`: string, `dosage`: string, `scheduleType`: FIXED_TIMES|INTERVAL, `times?`: [string], `daysOfWeek?`: [int], `intervalHours?`: int, `startAt`: datetime, `endAt?`: datetime, `continuous`: bool, `notes?`: string, `status`: ACTIVE|ENDED

**MedicationPlanInput** — `name`: string, `dosage`: string, `scheduleType`: FIXED_TIMES|INTERVAL, `times?`: [string], `daysOfWeek?`: [int], `intervalHours?`: int, `startAt`: datetime, `endAt?`: datetime, `continuous?`: bool, `notes?`: string

**MedicationPlanPatch** — `name?`: string, `dosage?`: string, `scheduleType?`: FIXED_TIMES|INTERVAL, `times?`: [string], `daysOfWeek?`: [int], `intervalHours?`: int, `endAt?`: datetime, `continuous?`: bool, `notes?`: string

**PlanStatusRequest** — `status`: ACTIVE|ENDED, `endAt?`: datetime, `continuous?`: bool

**Prescription** — `id`: uuid, `memberId`: uuid, `issuedOn`: date, `doctorName?`: string, `notes?`: string, `status`: ACTIVE|COMPLETED|CANCELLED, `issuedBy`: FAMILY|CLINIC (default FAMILY, D18), `appointmentId?`: uuid (consulta de origem, só se `issuedBy=CLINIC`, BR-RX-07), `medications`: [MedicationPlan], `documentIds`: [uuid]

**PrescriptionInput** — `issuedOn`: date, `doctorName?`: string, `notes?`: string, `medications`: [MedicationPlanInput]

**PrescriptionPatch** — `issuedOn?`: date, `doctorName?`: string, `notes?`: string

**PrescriptionStatusRequest** — `status`: ACTIVE|COMPLETED|CANCELLED

**Dose** — `id`: uuid, `planId`: uuid, `medicationName`: string, `dosage`: string, `scheduledAt`: datetime, `status`: PENDING|TAKEN|NOT_TAKEN|UNCONFIRMED, `actedAt?`: datetime, `actedByUserId?`: uuid, `note?`: string

**DoseActionRequest** — `note?`: string

**DoseCorrectionRequest** — `status`: TAKEN|NOT_TAKEN, `note?`: string

**Appointment** — `id`: uuid, `memberId`: uuid, `scheduledAt`: datetime, `status`: REQUESTED|SCHEDULED|REJECTED|COMPLETED|NO_SHOW|CANCELLED, `professionalName?`: string, `specialty?`: string, `clinicId?`: uuid, `clinicName?`: string, `slotId?`: uuid (horário de clínica parceira de origem, D17), `responseNote?`: string (motivo da clínica ao recusar/cancelar, D17), `reason?`: string, `notes?`: string, `confirmationStatus`: ConfirmationStatus, `followUpDueOn?`: date (M14 Q)

**AppointmentInput** — `scheduledAt`: datetime, `professionalName?`: string, `specialty?`: string, `clinicId?`: uuid, `clinicName?`: string, `slotId?`: uuid (marcação de clínica parceira; incompatível com `clinicId`/`clinicName`, nasce `REQUESTED`, D17), `reason?`: string, `notes?`: string, `status?`: SCHEDULED|COMPLETED (ignorado se `slotId` presente — nasce sempre `REQUESTED`)

**AppointmentPatch** — `scheduledAt?`: datetime, `professionalName?`: string, `specialty?`: string, `clinicId?`: uuid, `clinicName?`: string, `reason?`: string, `notes?`: string (BR-APT-09: consulta de clínica parceira só edita `notes`; mudar `scheduledAt` é cancelar e pedir outro horário)

**AppointmentStatusRequest** — `status`: SCHEDULED|REJECTED|COMPLETED|NO_SHOW|CANCELLED (a família nunca define `REQUESTED`/`REJECTED`, nem confirma `REQUESTED → SCHEDULED` — exclusivo do portal da clínica, D17)

**AvailableSlot** — `id`: uuid, `clinicId`: uuid, `clinicName`: string, `kind`: APPOINTMENT|EXAM, `specialty`: string (em `EXAM`, tipo de exame), `professionalName?`: string, `startsAt`: datetime, `durationMinutes`: int, `capacity`: int (1–50; 1 em APPOINTMENT), `remaining`: int (≥ 1 nas listagens, BR-APT-11)

**Clinic** — `id`: uuid, `name`: string, `address?`: string, `phone?`: string, `email?`: string, `type`: PARTNER|PRIVATE, `status`: ACTIVE|ARCHIVED, `displayName?`: string, `description?`: string, `openingHours?`: string (M14 R, BR-CLN-38; a app mostra `displayName ?? name`)

**ClinicInput** — `name`: string, `address?`: string, `phone?`: string, `email?`: string

**ClinicPatch** — `name?`: string, `address?`: string, `phone?`: string, `email?`: string

**ClinicStatusRequest** — `status`: ACTIVE|ARCHIVED

**ClinicRootAccountRequest** — `email`: string (D18; a palavra-passe inicial é enviada por e-mail, fora do corpo da resposta — detalhe de implementação)

**ExamResult** — `id`: uuid, `parameter`: string, `valueNumeric?`: number, `valueText?`: string, `unit?`: string, `referenceMin?`: number, `referenceMax?`: number, `createdAt`: datetime (só na resposta)

### Portal da clínica (`/clinic-portal/*`, D17/D18)

**ClinicLoginRequest** — `email`: string, `password`: string

**ClinicTokenResponse** — `accessToken`: string, `expiresIn`: int, `clinicId`: uuid, `role`: CLINIC_ADMIN|CLINIC_MANAGER|CLINIC_DOCTOR, `professionalId?`: uuid

**ClinicAccount** — `id`: uuid, `clinicId`: uuid, `email`: string, `role`: CLINIC_ADMIN|CLINIC_MANAGER|CLINIC_DOCTOR, `professionalId?`: uuid (só `CLINIC_DOCTOR`, M14 R), `status`: ACTIVE|SUSPENDED

**ClinicStaffInput** — `email`: string, `role?`: CLINIC_MANAGER|CLINIC_DOCTOR (omissão `CLINIC_MANAGER`, nunca `CLINIC_ADMIN`; BR-CLN-05/39), `professionalId?`: uuid (obrigatório em `CLINIC_DOCTOR`, proibido em `CLINIC_MANAGER`); a palavra-passe inicial é enviada por e-mail

**ClinicSlot** — `id`: uuid, `clinicId`: uuid, `kind`: APPOINTMENT|EXAM (BR-APT-10), `specialty`: string, `professionalName?`: string, `startsAt`: datetime, `durationMinutes`: int, `capacity`: int (BR-APT-11; 1–50, sempre 1 em APPOINTMENT)

**ClinicSlotView** — campos de `ClinicSlot` + `bookedCount`: int (marcações ativas: exames `SCHEDULED`; consulta `REQUESTED`/`SCHEDULED`), `remaining`: int (`capacity − bookedCount`), `state`: FREE|REQUESTED|SCHEDULED|PARTIAL|FULL (APPOINTMENT: FREE|REQUESTED|SCHEDULED; EXAM: FREE se `bookedCount=0`, PARTIAL, FULL se `remaining=0`)

**ClinicSlotPatch** — `capacity`: int (1–50; só `kind=EXAM`; não inferior a `bookedCount`)

**ClinicSlotBatchInput** — `kind?`: APPOINTMENT|EXAM (default APPOINTMENT), `capacity?`: int (1–50, default 1; > 1 só com `kind=EXAM`, BR-APT-11), `date`: date (dia local), `times`: [string] (HH:mm locais), `specialty`: string, `professionalName?`: string, `durationMinutes`: int (15|20|30|45|60, BR-CLN-04)

**ClinicBooking** — `id`: uuid, `status`: REQUESTED|SCHEDULED|REJECTED|COMPLETED|NO_SHOW|CANCELLED, `scheduledAt`: datetime, `specialty?`: string, `professionalName?`: string, `patientName`: string, `notes?`: string, `responseNote?`: string (mínimo necessário, BR-CLN-03 — nunca dados de saúde da família), `source?`: VITA|MANUAL, `clinicPatientId?`: uuid, `slotId?`: uuid (M14 P), `confirmationStatus`, `confirmationSource?`: PATIENT|CLINIC, `dayState`: SCHEDULED|ARRIVED|IN_PROGRESS|COMPLETED|NO_SHOW|CANCELLED|REQUESTED|REJECTED, `arrivedAt?`, `startedAt?`: datetime, `waitingMinutes?`: int, `followUpDueOn?`: date (M14 Q) · M14 R: `receiptId?`: uuid (recibo `ISSUED`; nunca para o Médico)

**ConfirmationStatus** — PENDING|CONFIRMED|DECLINED (M14 Q, BR-CLN-25)

**AppointmentConfirmationRequest** — `response`: GOING|CANNOT

**ClinicFollowUpRequest** — `amount`: int (1–24), `unit`: WEEKS|MONTHS

**ClinicFollowUp** — `bookingId`: uuid, `source`: VITA|MANUAL, `clinicPatientId?`: uuid, `patientName`: string, `patientPhone?`: string, `dueOn`: date, `patientNotified`: bool (derivado)

**ReportCounts** — `slotsTotal`, `slotsBooked`: int, `occupancyRate?`: number 0..1, `completed`, `noShows`: int, `noShowRate?`: number 0..1, `cancellations`, `declinedByPatient`: int (BR-CLN-29)

**ClinicReportSummary** — `from`, `to`: date, `totals`: `ReportCounts` + `newPatients`, `examsCompleted`, `byProfessional`: [`ReportCounts` + `professionalId?`, `professionalName?`]

**ClinicRequestResponse** — `decision`: CONFIRM|REJECT, `note?`: string (motivo, só relevante em `REJECT`)

**ClinicCancelRequest** — `note`: string (motivo obrigatório, UC-CLN-06)

**ClinicCompleteAppointmentRequest** — `outcomeNote?`: string (resultado da consulta, BR-CLN-06), `prescription?`: `PrescriptionInput` (opcional; se presente, cria a receita com `issuedBy=CLINIC`, BR-RX-07) **M15 S:** `report?`: `ConsultationReportInput` (só `CLINIC_DOCTOR`; grava e finaliza atomicamente).

**ClinicPatient** — `id`: uuid, `name`: string, `phone?`: string, `email?`: string, `birthDate?`: date, `notes?`: string, `origin`: MANUAL|VITA, `vitaLink?`: `ClinicPatientVitaLink`, `createdAt`, `updatedAt` (BR-CLN-17; nunca ids Vita)

**ClinicPatientVitaLink** — `via`: EMAIL|CODE, `consentLevel?`: BOOKINGS|HISTORY, `consentValidUntil?`: datetime

**ClinicPatientInput** / **ClinicPatientPatch** — `name` (1–120; obrigatório só no Input), `phone?` (`^[+0-9 ()-]{5,30}$`), `email?`, `birthDate?` (não futura), `notes?` (≤2000); no Patch `null` limpa os opcionais e exige ≥1 campo

**ClinicPatientPage** — `items`: [ClinicPatient], `nextCursor?`: string

**ClinicPatientLinkRequest** — `code`: string (8 caracteres, hífen opcional), `clinicPatientId?`: uuid

**ClinicPatientRecord** — `patient`: ClinicPatient, `bookings`: [ClinicBooking], `examinations`: [ClinicExamBooking], `recommendations`: [ClinicRecommendation]

**ClinicSharedHistory** — `active`: bool, `level?`, `validUntil?`, `medications`: [`name`, `dosage`, `startAt`, `endAt?`, `continuous`], `examinations`: [`name`, `examDate`, `status`: SCHEDULED|COMPLETED, `results`: [`parameter`, `valueNumeric?`, `valueText?`, `unit?`, `referenceMin?`, `referenceMax?`]] (BR-CLN-21)

**ClinicCalendarEntry** — `id`, `source`: VITA|MANUAL, `kind`: APPOINTMENT|EXAM, `status`, `startsAt`, `endsAt`, `professionalId?`, `professionalName?`, `specialty?`, `patientName`, `clinicPatientId?`, `slotId?`, `confirmationStatus?`, `dayState?`, `arrivedAt?`, `waitingMinutes?` (M14 Q; nulos em exames)

**ClinicCalendarFreeSlot** — `slotId`, `kind`, `startsAt`, `endsAt`, `professionalId?`, `professionalName?`, `specialty`, `remaining`

**ClinicCalendar** — `from`, `to`, `entries`: [ClinicCalendarEntry], `freeSlots`: [ClinicCalendarFreeSlot]

**ClinicSearchResult** — `patients`: [ClinicPatient] (≤10), `bookings`: [ClinicCalendarEntry] (≤10)

**ClinicConsent** (família) — `clinicId`, `clinicName`, `level`: BOOKINGS|HISTORY (efetivo), `validUntil?`, `renewalNeeded`: bool, `linked`: bool; **ClinicConsentInput** — `level`; **ClinicLinkCode** — `code`: string, `expiresAt`: datetime

**ClinicExamBooking** — `id`: uuid, `status`: SCHEDULED|COMPLETED|CANCELLED, `slotId?`: uuid, `scheduledAt`: datetime, `examType?`: string, `professionalName?`: string, `patientName`: string, `notes?`: string, `responseNote?`: string, `resultsCount?`: int, `documents?`: [ClinicDocumentView], `resultsIssuedAt?`: datetime, `receiptId?`: uuid (M14 R; recibo `ISSUED`, nunca para o Médico) (mínimo necessário, BR-CLN-03; nunca os valores dos resultados)

**ClinicReceipt** (M14 R) — `id`, `number`: int (apresentar `R-` + 6 dígitos), `bookingKind`: APPOINTMENT|EXAM|VISIT, `bookingId`: uuid, `status`: ISSUED|VOIDED, `paymentMethod`: CASH|CARD|TRANSFER|INSURANCE, `currency`, `totalMinor`: int (cêntimos), `patientName`, `note?`, `issuer`: {`name`, `address?`, `phone?`, `email?`}, `lines`: [`position`, `description`, `amountMinor`, `serviceTypeId?`], `issuedAt`, `issuedByClinicAccountId?`, `voidedAt?`, `voidReason?`, `voidedByClinicAccountId?`, `notice` ("Documento não fiscal — não substitui fatura"), `availableToPatient`: bool

**ClinicReceiptInput** — `bookingKind`, `bookingId`, `paymentMethod`, `lines?`: [{ `serviceTypeId?`, `description?` (1–120), `amountMinor?` (0–10¹¹) }] (1–20; linha de catálogo = `serviceTypeId` com `amountMinor` opcional; livre = `description` + `amountMinor`; omitido ⇒ serviço do horário), `note?` (≤200) · **ClinicReceiptVoidRequest** — `reason` (3–200)

**ClinicReceiptPage** — `items`: [ClinicReceipt], `nextCursor?`, `summary`: {`issuedCount`, `issuedTotalMinor`, `voidedCount`, `currency`}

**FamilyClinicReceipt** — `id`, `number`, `clinicName`, `clinicAddress?`, `clinicPhone?`, `status`, `paymentMethod`, `currency`, `totalMinor`, `patientName`, `note?`, `lines`: [`description`, `amountMinor`], `issuedAt`, `voidedAt?`, `notice`, `attachedToClaimIds?`: [uuid] (sem motivo de anulação nem ids da clínica) · **FamilyClinicReceiptPage** — `items`, `nextCursor?`

**ClaimReceiptRef** — `receiptId`, `number`, `status`, `totalMinor`, `currency` · **InsuranceClaimReceipt** — `number`, `issuedAt`, `clinicName`, `lines`: [`description`, `amountMinor`], `totalMinor`, `currency`, `status` (resumo mínimo, BR-CLN-36)

**ClinicProfile** — `name` (só leitura), `displayName?` (1–120), `address?` (≤200), `phone?` (≤30), `email?` (≤254), `openingHours?` (≤500), `description?` (≤500), `currency` (só leitura) · **ClinicProfileInput** — os seis campos editáveis, parcial, `null` limpa (≥ 1 campo)

**ClinicAuditEntry** — `id`, `occurredAt`, `action`, `resourceType`, `resourceId?`, `result`: SUCCESS|DENIED|FAILURE, `actorAccountId?` · **ClinicAuditPage** — `items`, `nextCursor?` (BR-CLN-40; sem PII)

**ClinicDocumentView** — `id`: uuid, `originalName`: string, `sizeBytes`: int, `scanStatus`: PENDING|CLEAN|INFECTED, `createdAt`: datetime (só metadados, BR-CLN-08)

**ClinicExamDocumentUploadRequest** — `file`: binary (só PDF)

**ClinicCompleteExaminationRequest** — `results?`: [ExamResultInput] (0–50), `resultNote?`: string (≤2000); pelo menos um resultado ou um PDF carregado (BR-CLN-08) **M15 T:** `generateReport?`: bool (omissão `true`); sem `results` usa o rascunho.

**ConsultationReportInput** (M15 S) — `reason?` (≤300), `findings?` (≤1500), `impression?` (≤500), `plan?` (≤1500), `sharedWithPatient?`: bool (omissão `true`); ≥1 secção; texto simples · **ConsultationReportAddendumInput** — `text` (1–1500) · **ConsultationReportAddendum** — `id`, `text`, `authorName`, `createdAt`

**ConsultationReport** (clínica) — `id`, `bookingKind`: APPOINTMENT|VISIT, `bookingId`, `status`: DRAFT|FINAL, `reason?`, `findings?`, `impression?`, `plan?`, `sharedWithPatient`, `patientName`, `patientBirthDate?`, `consultationAt`, `specialty?`, `authorName` (assinatura textual), `authorAccountId?`, `finalizedAt?`, `addenda`: [ConsultationReportAddendum], `createdAt`, `updatedAt` · **FamilyConsultationReport** (titular/tutor) — `appointmentId`, `clinicName`, `consultationAt`, `specialty?`, `authorName`, `reason?`, `findings?`, `impression?`, `plan?`, `finalizedAt`, `addenda`, `notice` (sem ids da clínica/conta)

**ClinicExamResultsDraftInput** (M15 T) — `results?`: [ExamResultInput] (0–50), `resultNote?` (≤2000); ≥1 resultado ou nota · **ClinicExamResultsDraft** — `examinationId`, `status`: DRAFT, `results`, `resultNote?`, `updatedAt`

**Campos acrescentados (M15):** `ClinicBooking.reportStatus?`: DRAFT|FINAL · `ClinicExamBooking.hasResultsDraft?`, `reportAvailable?` · `ClinicDocumentView.generatedBySystem?`, `Document.generatedBySystem?` · `Appointment.reportAvailable?`

**ClinicRecommendationInput** — `appointmentId?`: uuid, `examinationId?`: uuid (exatamente um, BR-CLN-09), `text`: string (1–2000)

**ClinicRecommendation** — `id`: uuid, `appointmentId?`: uuid, `examinationId?`: uuid, `patientName`: string, `text`: string, `createdAt`: datetime

**Recommendation** — `id`: uuid, `memberId`: uuid, `appointmentId?`: uuid, `examinationId?`: uuid, `clinicName`: string, `text`: string, `createdAt`: datetime (ADR-023)

**ExamResultInput** — `parameter`: string, `valueNumeric?`: number, `valueText?`: string, `unit?`: string, `referenceMin?`: number, `referenceMax?`: number

**ExamResultPatch** — `parameter?`: string, `valueNumeric?`: number, `valueText?`: string, `unit?`: string, `referenceMin?`: number, `referenceMax?`: number

**ExamResultHistoryItem** — `examinationId`: uuid, `examDate`: date, `valueNumeric?`: number, `valueText?`: string, `unit?`: string, `referenceMin?`: number, `referenceMax?`: number

**Examination** — `id`: uuid, `memberId`: uuid, `name`: string, `examDate`: date, `status`: SCHEDULED|COMPLETED|CANCELLED, `scheduledAt?`: datetime, `clinicId?`: uuid, `clinicName?`: string, `slotId?`: uuid, `responseNote?`: string, `notes?`: string, `issuedBy`: FAMILY|CLINIC, `issuedByClinicAccountId?`: uuid, `resultsIssuedAt?`: datetime, `clinicResultNote?`: string, `results`: [ExamResult], `documentIds`: [uuid]

**ExaminationInput** — `name`: string, `examDate`: date, `clinicId?`: uuid, `clinicName?`: string, `slotId?`: uuid (marcação num horário `EXAM` com vaga; nasce SCHEDULED e name/examDate/clínica são os do horário, BR-EXM-05), `notes?`: string

**ExaminationPatch** — `name?`: string, `examDate?`: date, `clinicId?`: uuid, `clinicName?`: string, `notes?`: string

**ExamStatusRequest** — `status`: SCHEDULED|COMPLETED|CANCELLED (`REQUESTED`/`REJECTED` já não existem na API, ADR-023 revisto)

**UploadDocumentRequest** — `file`: binary, `resourceType`: PRESCRIPTION|EXAMINATION|INSURANCE_POLICY (ADR-021), `resourceId`: uuid

**Document** — `id`: uuid, `resourceType`: PRESCRIPTION|EXAMINATION|INSURANCE_POLICY (ADR-021), `resourceId`: uuid, `originalName`: string, `mimeType`: string, `sizeBytes`: int, `scanStatus`: PENDING|CLEAN|INFECTED, `createdAt`: datetime

**Alert** — `id`: uuid, `type`: MEDICATION_DUE|APPOINTMENT_REMINDER|EXAM_REMINDER|APPOINTMENT_OUTCOME_REQUEST|APPOINTMENT_CONFIRMED|APPOINTMENT_REJECTED|APPOINTMENT_CANCELLED|EXAM_CANCELLED|EXAM_RESULTS_AVAILABLE|RECOMMENDATION_ADDED|APPOINTMENT_CONFIRM_REQUEST|FOLLOWUP_REMINDER, `familyId`: uuid, `memberId`: uuid, `memberName`: string, `message`: string, `sourceType`: DOSE|APPOINTMENT|EXAMINATION|RECOMMENDATION, `sourceId`: uuid, `triggerAt`: datetime, `readAt?`: datetime

**AdherenceItem** — `planId`: uuid, `medicationName`: string, `taken`: int, `notTaken`: int, `unconfirmed`: int, `pending`: int

**PendingItem** — `type`: UNCONFIRMED_DOSE|APPOINTMENT_OUTCOME|EXAM_OUTCOME, `sourceId`: uuid, `date`: datetime

**MemberReport** — `generatedAt`: datetime, `from`: date, `to`: date, `member`: Member, `bloodType?`: string, `allergies?`: [Allergy], `conditions?`: [Condition], `prescriptions?`: [Prescription], `medicationPlans?`: [MedicationPlan], `adherence?`: [AdherenceItem], `appointments?`: [Appointment], `examinations?`: [Examination]

**FamilyReportMember** — `member`: Member, `allergies?`: [Allergy], `conditions?`: [Condition], `activeMedications?`: [MedicationPlan], `upcomingAppointments?`: [Appointment], `upcomingExaminations?`: [Examination], `pending?`: [PendingItem]

**FamilyReport** — `generatedAt`: datetime, `members`: [FamilyReportMember]

**AdminUserDetail** — `id`: uuid, `email`: email, `name`: string, `status`: PENDING_VERIFICATION|ACTIVE|SUSPENDED, `platformRole`: NONE|PLATFORM_ADMIN, `emailVerifiedAt?`: datetime, `createdAt`: datetime, `suspendedAt?`: datetime, `suspensionReason?`: string, `familiesCount`: int, `activeSessionsCount`: int, `lastSessionUsedAt?`: datetime (BR-ADM-01; nunca saúde)

**AdminClinicAccount** — `id`: uuid, `clinicId`: uuid, `email`: email, `role`: CLINIC_ADMIN|CLINIC_MANAGER|CLINIC_DOCTOR, `status`: ACTIVE|SUSPENDED, `createdAt`: datetime, `lastLoginAt?`: datetime, `suspendedAt?`: datetime (BR-ADM-03)

**AdminUser** — `id`: uuid, `email`: email, `name?`: string, `status`: PENDING_VERIFICATION|ACTIVE|SUSPENDED, `createdAt`: datetime

**SuspendRequest** — `reason`: string

**InsurancePolicy** — `id`: uuid, `insurerId?`: uuid (seguradora parceira, BR-INS-09), `insurerName`: string, `policyNumber`: string, `holderName`: string, `validUntil?`: date, `cardDocumentId?`: uuid, `createdAt`: datetime (ADR-021)

**InsurancePolicyInput** — `insurerId?`: uuid (de `GET /families/{id}/insurers`), `insurerName`: string, `policyNumber`: string, `holderName`: string, `validUntil?`: date, `cardDocumentId?`: uuid

**InsurancePolicyPatch** — `insurerId?`: uuid, `insurerName?`: string, `policyNumber?`: string, `holderName?`: string, `validUntil?`: date, `cardDocumentId?`: uuid

**ReimbursementClaim** — `id`: uuid, `policyId`: uuid, `amount`: number, `currency`: string, `status`: SUBMITTED|APPROVED|REJECTED|PAID, `decisionNote?`: string, `documentIds`: [uuid], `receipts`: [ClaimReceiptRef] (M14 R), `createdAt`: datetime (ADR-021)

**ReimbursementClaimInput** — `amount`: number, `currency?`: string, `documentIds?`: [uuid], `receiptIds?`: [uuid] (M14 R, BR-CLN-36; `documentIds` + `receiptIds` entre 1 e 10 no total, BR-INS-04)

**InsuranceLoginRequest** — `email`: email, `password`: string

**InsuranceTokenResponse** — `accessToken`: string, `expiresIn`: int, `insurerId`: uuid, `role`: INSURANCE_ADMIN|INSURANCE_AGENT

**InsuranceAccount** — `id`: uuid, `insurerId`: uuid, `email`: email, `role`: INSURANCE_ADMIN|INSURANCE_AGENT, `status`: ACTIVE|SUSPENDED

**InsuranceAgentInput** — `email`: email (a conta criada é sempre `INSURANCE_AGENT`, BR-INS-06)

**InsuranceClaimView** — `id`: uuid, `status`: SUBMITTED|APPROVED|REJECTED|PAID, `amount`: number, `currency`: string, `policyHolderName`: string, `policyNumber`: string, `decisionNote?`: string, `documentIds`: [uuid], `receipts`: [InsuranceClaimReceipt] (M14 R, BR-CLN-36) (mínimo necessário, ADR-021)

**InsuranceClaimDecisionRequest** — `decision`: APPROVE|REJECT, `note?`: string (obrigatório em REJECT, BR-INS-05)

**Insurer** — `id`: uuid, `name`: string, `taxId`: string, `status`: ACTIVE|SUSPENDED

**PartnerInsurer** — `id`: uuid, `name`: string (BR-INS-09)

**InsurerPatch** — `name?`: string, `taxId?`: string (BR-ADM-05)

**InsurerInput** — `name`: string, `taxId`: string

**InsurerStatusRequest** — `status`: ACTIVE|SUSPENDED

**InsurerRootAccountRequest** — `email`: email (a palavra-passe inicial é enviada por e-mail, ADR-021)

**HealthStatus** — `status`: string


> Total: 170 operações, 125 schemas (revisto em 2026-11-04; a contagem anterior estava desatualizada).
