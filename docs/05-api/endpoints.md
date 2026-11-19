# Vita Family — Endpoints (Fase 13)

> Estado: **v0.16 (MK2, 2026-11-17: +25 operações de descoberta, comparação, ranking e conversas — `/marketplace/*`, `/families/{f}/members/{m}/conversations*`, `/professional-portal/conversations*`, `/admin/message-reports*`; 271 no total; secção «Mercado de profissionais — MK2»; contratual, sem código)**; v0.15 (MK1, 2026-11-16: +34 operações do mercado de profissionais — `/professional-portal/*` e `/admin/professionals*`, `/admin/specialties*`; secção «Mercado de profissionais — MK1»; contratual, sem código)**; v0.14 (R6 do arquivo do marco B, ADR-037, 2026-11-16: removidas as 100 operações de seguradora/autorização/reembolso/cartão e os respetivos schemas, as tags `Insurance`/`Insurance Portal`, o esquema `insuranceBearerAuth`, `Process.coverage` e os códigos `COVERAGE_*`/`AWAIT_INSURER_DECISION`/`AWAIT_CLINIC_INFORMATION`/actor `INSURER`; `AUTHORIZATION_*` em `AlertType` mantêm-se como legado inerte).** O histórico das fatias do marco B está em `docs/_arquivo/marco-b/` e na tag `archive-marco-b-2026-11-16`.

## Autenticação do portal da clínica (D17/D18, ADR-020)

As rotas `/clinic-portal/*` usam um **token distinto** do de User: `Authorization: Bearer <clinicAccessToken>`, com claims `clinicAccountId`, `clinicId`, `role` (nunca `userId`/`familyId`). Emitido só por `POST /clinic-portal/auth/login`; nunca aceite nas restantes rotas da API (e o token de User nunca é aceite em `/clinic-portal/*`). Ver ADR-020.

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
| PROFESSIONAL_ACCOUNT | Qualquer `ProfessionalAccount` autenticado com e-mail verificado (MK1, ADR-037), token distinto do de User e do de ClinicAccount, só em `/professional-portal/*`. **Atenção:** o estado de validação do profissional (`DRAFT`, `PENDING_REVIEW`, `NEEDS_INFO`, `APPROVED`, `REJECTED`, `SUSPENDED`) restringe as escritas segundo `authorization.md` §10.2 (`PROFESSIONAL_LOCKED`). |
| CLINIC_ADMIN | Só `ClinicAccount` com `role=CLINIC_ADMIN` da própria clínica. |
| CLINIC_ADMIN_MANAGER | `CLINIC_ADMIN` ou `CLINIC_MANAGER` (receção) da própria clínica; `CLINIC_DOCTOR` ⇒ `FORBIDDEN` (M14 R). |

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
- **BUSINESS RULES:** BR-CLN-35: sem motivo de anulação nem ids da clínica.

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

### `GET /families/{familyId}/members/{memberId}/exam-orders`  — listFamilyExamOrders
- **AUTHORIZATION:** Titular (SELF adulto) ou tutor (TUTOR_OF) com READ(APPOINTMENTS) (`authorization.md` §6.7)
- **DESCRIPTION:** Listar os pedidos de exame que clínicas emitiram ao membro em consultas Vita (UC-CLN-42, M15 U).
- **QUERY:** `status` (`ORDERED|SCHEDULED|FULFILLED|CANCELLED`; omissão: todos exceto `CANCELLED`), `appointmentId` (uuid)
- **RESPONSE:** `200` `FamilyExamOrderList` (`items: [FamilyExamOrder]`)
- **ERRORS:** `FORBIDDEN` (DEPENDENT_SELF, OTHER), `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-52/53: independente de `ClinicConsent`; visitas manuais não aparecem; sem conta autora. Para marcar: `examOrderId` em `POST …/examinations`. Sem auditoria da leitura (a marcação com pedido audita `EXAM_ORDER_LINKED`).
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

### `GET /clinic-portal/exam-service-types`  — listClinicExamServiceTypes
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN`, `CLINIC_MANAGER` e `CLINIC_DOCTOR`)
- **DESCRIPTION:** Listar os serviços de exame **ativos** da própria clínica para escolher o exame ao criar um pedido (M15 U, emenda ADR-028). Rota estreita: o catálogo completo (`GET /clinic-portal/services`) continua só Admin/Gestor.
- **RESPONSE:** `200` `[ClinicExamServiceTypeOption]` (`id`, `name`, `durationMinutes`; sem preço/moeda; ordem por nome)
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-51. Só `kind=EXAM` e `active=true` da clínica do token. Sem auditoria da leitura.

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
- **BUSINESS RULES:** BR-CLN-06, BR-RX-07: a receita (se incluída) é criada no módulo `prescriptions` com `issuedBy=CLINIC` e `appointmentId` de origem, e passa a aparecer no histórico do paciente; a clínica só pode completar a consulta em curso que a própria clínica está a atender. **«Concluir ato» (fatia 3, BR-CLN-57):** `receipt` opcional (`ClinicCompleteReceiptInput`: `paymentMethod`, `lines?`, `note?`) emite o recibo (BR-CLN-31..35) na mesma transação, depois de `COMPLETED`; só Admin/Gestor (Médico com `receipt` ⇒ `FORBIDDEN` sem efeito, BR-CLN-39); falha do recibo ⇒ nada gravado. `expense` fica reservado à fatia 2b.

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

### `GET /clinic-portal/agenda/{appointmentId}/exam-orders`  — listClinicExamOrders
- **AUTHORIZATION:** CLINIC_ACCOUNT (Admin e Gestor qualquer marcação; Médico as suas — `authorization.md` §6.2b)
- **DESCRIPTION:** Listar os pedidos de exame da marcação (UC-CLN-41, M15 U), incluindo `CANCELLED`.
- **RESPONSE:** `200` `ClinicExamOrderList`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-51/52: `SCHEDULED`/`FULFILLED` só se o exame ligado é da própria clínica, senão `ORDERED`. Leitura auditada (`EXAM_ORDER_VIEWED`, sem texto).

### `POST /clinic-portal/agenda/{appointmentId}/exam-orders`  — createClinicExamOrders
- **AUTHORIZATION:** `CLINIC_DOCTOR` (suas); Admin/Gestor ⇒ `FORBIDDEN`
- **DESCRIPTION:** Pedir 1–5 exames na consulta ou visita (UC-CLN-39).
- **REQUEST:** `ClinicExamOrdersInput` (`items` 1–5: `name` ou `serviceTypeId`, `note?`, `urgent?`)
- **RESPONSE:** `201` `ClinicExamOrderList` (todos os pedidos da marcação)
- **ERRORS:** `FORBIDDEN`, `INVALID_STATE_TRANSITION` (marcação cancelada/faltou/pedida), `LIMIT_EXCEEDED` (>5 ativos), `NOT_FOUND`, `RATE_LIMITED` (30/min por conta), `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-CLN-51/53/56. Marcação `SCHEDULED` ou `COMPLETED`; imutável. Consulta Vita: ponte + alerta genérico `EXAM_ORDER_ADDED` na mesma transação. Auditoria `EXAM_ORDER_CREATED`.

### `PUT /clinic-portal/agenda/{appointmentId}/exam-orders/{orderId}/cancel`  — cancelClinicExamOrder
- **AUTHORIZATION:** `CLINIC_DOCTOR` (suas); Admin/Gestor ⇒ `FORBIDDEN`
- **DESCRIPTION:** Cancelar um pedido (UC-CLN-40).
- **RESPONSE:** `200` `ClinicExamOrder`
- **ERRORS:** `FORBIDDEN`, `INVALID_STATE_TRANSITION` (cumprido na própria clínica), `NOT_FOUND`, `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-52. Idempotente; não toca no `Examination` do paciente. Auditoria `EXAM_ORDER_CANCELLED`.

### `GET /clinic-portal/agenda/{appointmentId}/exam-orders/pdf`  — getClinicExamOrdersPdf
- **AUTHORIZATION:** CLINIC_ACCOUNT (como `GET …/exam-orders`)
- **DESCRIPTION:** PDF imprimível "Pedido de exame" com os pedidos ativos (UC-CLN-41).
- **RESPONSE:** `200` `application/pdf` (`Cache-Control: private, no-store`; `Content-Disposition: inline; filename="pedido-exame-AAAAMMDD.pdf"`)
- **ERRORS:** `NOT_FOUND` (inclui sem pedidos ativos), `RATE_LIMITED` (30/min por conta, bolsa partilhada), `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-54. Gerado a pedido (não guardado). Auditoria `EXAM_ORDER_VIEWED` (`format=PDF`).

### `GET /clinic-portal/agenda/{appointmentId}/attendance-statement/pdf`  — getClinicAttendanceStatementPdf
- **AUTHORIZATION:** CLINIC_ACCOUNT (Admin e Gestor qualquer marcação; Médico as suas)
- **DESCRIPTION:** PDF "Declaração de presença" (UC-CLN-43, M15 V).
- **QUERY:** `includeProfessional` (bool, omissão `false`)
- **RESPONSE:** `200` `application/pdf` (`Cache-Control: private, no-store`; `Content-Disposition: inline; filename="declaracao-AAAAMMDD.pdf"`)
- **ERRORS:** `INVALID_STATE_TRANSITION` (não `COMPLETED` nem `SCHEDULED` com chegada), `NOT_FOUND`, `RATE_LIMITED` (30/min por conta, bolsa partilhada), `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-CLN-55. Sem especialidade/diagnóstico; não se guarda; só a clínica emite. Auditoria `ATTENDANCE_STATEMENT_ISSUED`.

**Alterações a endpoints existentes (retrocompatíveis, M15 U):** `PUT /clinic-portal/agenda/{id}/complete` aceita `examOrders` (`ExamOrderItemInput[1..5]`; só `CLINIC_DOCTOR`, senão `FORBIDDEN`; atómico); `ClinicBooking` ganha `examOrderCount`; `Appointment` (família) ganha `examOrderCount`; `ExaminationInput` ganha `examOrderId` (`POST …/examinations`: `NOT_FOUND` se não visível, `CONFLICT` se o pedido já não está `ORDERED`; liga na mesma transação); o `Alert.type` ganha `EXAM_ORDER_ADDED`.

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

**Alterações a endpoints existentes (retrocompatíveis, M14 R):** `ClinicAccount`/`ClinicTokenResponse` ganham `role=CLINIC_DOCTOR` e `professionalId`; `ClinicStaffInput` ganha `role` e `professionalId`; `Clinic` ganha `displayName`, `description`, `openingHours` (listas de clínicas da família); `ClinicBooking`/`ClinicExamBooking` ganham `receiptId` (nunca para o Médico). As restantes rotas do portal mantêm o contrato, com o filtro/negação por papel de `authorization.md` §6.2b.

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
- **BUSINESS RULES:** ST5: data passada nasce COMPLETED; futura nasce SCHEDULED com lembrete 24 h; com `slotId` nasce `SCHEDULED` (BR-EXM-05) com lembrete 24 h (BR-EXM-06; data/hora vêm do horário, exige `startsAt` futuro); a vaga é reservada atomicamente sob bloqueio do horário (BR-APT-11); o utilizador é avisado da minimização (BR-CLN-03) antes de enviar. **M15 U:** `examOrderId` (opcional) liga o exame a um pedido `ORDERED` do mesmo membro (BR-CLN-52; `NOT_FOUND`/`CONFLICT`); atómico com a criação.

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

## Alerts

### `GET /alerts`  — listAlerts
- **AUTHORIZATION:** AUTH
- **DESCRIPTION:** Listar os meus alertas.
- **QUERY:** `unread` (bool), `limit` (int), `cursor` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `{ items: [Alert], nextCursor }`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** UC-ALR-03: só alertas de que sou destinatário; não lidos primeiro. Os tipos `AUTHORIZATION_*` são legado inerte (arquivo do marco B, ADR-037): já não são gerados; só podem aparecer em alertas históricos.

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

## Processes (marco B, fatia 1 — ADR-032) — CONTRATUAL

> Contrato `_arquivo/marco-b/marco-b-construcao.md` §4 (fatia 1). **Sem endpoint público de criação, edição ou eliminação**: o `Process` abre-se e apaga-se como efeito da criação/eliminação do ato (BR-PRC-01/07). `familyStatus` e `nextStep` são **derivados** (BR-PRC-02/03). Erros: só códigos já existentes (`errors.md`). Sem rate limit específico (leituras autenticadas, ids opacos; limite global da API).

### `GET /families/{familyId}/members/{memberId}/processes`  — listProcesses
- **AUTHORIZATION:** READ da categoria da origem de cada processo (APPOINTMENTS para consulta, EXAMS para exame; `authorization.md` §6.8). A lista **filtra**: omite os processos que o actor não pode ler (DEPENDENT_SELF só consultas; OTHER só com SharingGrant da categoria).
- **DESCRIPTION:** Listar os processos (atos) do membro, do mais recente para o mais antigo (`openedAt` desc, `id` desc).
- **QUERY:** `status` (SCHEDULED|IN_PROGRESS|DONE|CANCELLED), `originType` (APPOINTMENT|EXAMINATION), `limit` (1–100, omissão 25), `cursor` (string opaca)
- **REQUEST:** —
- **RESPONSE:** `200` `{ items: [Process], nextCursor }` (`nextCursor` nulo no fim)
- **ERRORS:** `MALFORMED_REQUEST` (400: `status`/`originType`/`limit` fora do contrato ou `cursor` inválido; parâmetros de query são validados pelo validador do contrato), `UNAUTHENTICATED`, `NOT_FOUND`, `MEMBER_BLOCKED`
- **BUSINESS RULES:** BR-PRC-02/03/05/09. O `nextStep` deriva só do ato (consulta/exame). `status` filtra **depois** da derivação: o servidor varre em lotes (máx. 200 processos por pedido) e pode devolver menos de `limit` itens com `nextCursor` não nulo; o cliente segue o cursor até ser nulo. Auditoria `PROCESS_VIEW` só se o actor não é o titular.

### `GET /families/{familyId}/members/{memberId}/processes/{processId}`  — getProcess
- **AUTHORIZATION:** READ da categoria da origem do processo (como acima).
- **DESCRIPTION:** Detalhe do processo: estado simples e "o que falta e de quem".
- **REQUEST:** —
- **RESPONSE:** `200` `Process`
- **ERRORS:** `UNAUTHENTICATED`, `NOT_FOUND`, `MEMBER_BLOCKED`
- **BUSINESS RULES:** BR-PRC-05: inexistente, de outro membro/família ou de categoria não legível ⇒ `404` (sem enumeração). `GET .../appointments/{id}` e `.../examinations/{id}` devolvem `processId` para o caminho inverso.

### `GET /clinic-portal/processes/{processId}`  — getClinicProcess
- **AUTHORIZATION:** CLINIC_ACCOUNT (`CLINIC_ADMIN`, `CLINIC_MANAGER`; `CLINIC_DOCTOR` ⇒ `FORBIDDEN`, `authorization.md` §6.2b)
- **DESCRIPTION:** Ler o processo do atendimento da própria clínica (`processId` vem em `ClinicBooking`/`ClinicExamBooking`).
- **REQUEST:** —
- **RESPONSE:** `200` `ClinicProcess`
- **ERRORS:** `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`
- **BUSINESS RULES:** BR-PRC-06: `clinic_id` do processo = clínica do token, senão `404` (inclui processo sem clínica e de outra clínica). Só id, tipo, origem, fase do ato e abertura; nunca `memberId`/`familyId`, `familyStatus` nem `nextStep`. Não auditada.

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

## Mercado de profissionais — MK1 (ADR-037) — CONTRATUAL

> Acrescentado 2026-11-16 (contrato de MK1; `vita-architect`). **Só contrato: nada implementado.** Tags `Professional Portal` e `Admin`. As rotas `/professional-portal/*` usam o token `professionalBearerAuth` (claims `professionalAccountId`, `professionalId`; nunca `userId`/`clinicAccountId`); o estado de validação do profissional restringe as escritas (`authorization.md` §10.2). Códigos novos: `PROFESSIONAL_LOCKED` (`errors.md`).

### `POST /professional-portal/auth/register`  — professionalRegister
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Registar conta de profissional.
- **REQUEST:** `ProfessionalRegisterRequest` (`email`, `password`, `termsVersion`)
- **RESPONSE:** `202` `Message`
- **ERRORS:** `PASSWORD_WEAK`, `VALIDATION_ERROR`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-13/14; UC-MKT-01. Auditoria `PROFESSIONAL_REGISTER`.

### `POST /professional-portal/auth/verify-email`  — professionalVerifyEmail
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Verificar e-mail com código de 6 dígitos (24 h).
- **REQUEST:** `VerifyEmailRequest`
- **RESPONSE:** `204`
- **ERRORS:** `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-14. Auditoria `PROFESSIONAL_EMAIL_VERIFIED`.

### `POST /professional-portal/auth/resend-verification`  — professionalResendVerification
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Reenviar o código de verificação.
- **REQUEST:** `ResendVerificationRequest`
- **RESPONSE:** `202` `Message`
- **ERRORS:** `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-14.

### `POST /professional-portal/auth/login`  — professionalLogin
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Iniciar sessão de um profissional.
- **REQUEST:** `LoginRequest`
- **RESPONSE:** `200` `ProfessionalTokenResponse`
- **ERRORS:** `AUTH_INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-13/14. Auditoria `PROFESSIONAL_LOGIN` / `PROFESSIONAL_LOGIN_FAILED`.

### `POST /professional-portal/auth/refresh`  — professionalRefreshToken
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Rodar o refresh token do profissional.
- **REQUEST:** —
- **RESPONSE:** `200` `ProfessionalTokenResponse`
- **ERRORS:** `UNAUTHENTICATED`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-13. Reutilização ⇒ cadeia revogada; `PROFESSIONAL_REFRESH_REUSE_DETECTED`.

### `POST /professional-portal/auth/logout`  — professionalLogout
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Terminar a sessão atual.
- **REQUEST:** —
- **RESPONSE:** `204`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-13. Auditoria `PROFESSIONAL_LOGOUT`.

### `POST /professional-portal/auth/password/forgot`  — professionalForgotPassword
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Pedir recuperação de palavra-passe.
- **REQUEST:** `ForgotPasswordRequest`
- **RESPONSE:** `202` `Message`
- **ERRORS:** `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-14.

### `POST /professional-portal/auth/password/reset`  — professionalResetPassword
- **AUTHORIZATION:** PUBLIC
- **DESCRIPTION:** Definir nova palavra-passe com código.
- **REQUEST:** `ResetPasswordRequest`
- **RESPONSE:** `204`
- **ERRORS:** `NOT_FOUND`, `PASSWORD_WEAK`, `VALIDATION_ERROR`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-14/29. Auditoria `PROFESSIONAL_PASSWORD_RESET`.

### `GET /professional-portal/me`  — getProfessionalMe
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Ver o próprio perfil, estado de validação e o que falta para submeter.
- **REQUEST:** —
- **RESPONSE:** `200` `ProfessionalProfile`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-15/16/23.

### `PATCH /professional-portal/me`  — updateProfessionalMe
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Alterar o perfil (nome de apresentação, bio, cidade, instruções de pagamento).
- **REQUEST:** `ProfessionalProfilePatch`
- **RESPONSE:** `200` `ProfessionalProfile`
- **ERRORS:** `PROFESSIONAL_LOCKED`, `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-23/26.

### `PUT /professional-portal/me/specialties`  — setProfessionalSpecialties
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Definir as especialidades do profissional (substitui o conjunto).
- **REQUEST:** `SpecialtyIdsInput` (`specialtyIds` 1–5)
- **RESPONSE:** `200` `ProfessionalProfile`
- **ERRORS:** `PROFESSIONAL_LOCKED`, `CONFLICT`, `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-22/23. Auditoria `PROFESSIONAL_SPECIALTIES_SET` (ids).

### `GET /professional-portal/specialties`  — listProfessionalSpecialtyCatalog
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Listar o catálogo de especialidades ativas.
- **REQUEST:** —
- **RESPONSE:** `200` `[Specialty]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-22.

### `GET /professional-portal/credentials`  — listProfessionalCredentials
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Listar as próprias credenciais (metadados).
- **REQUEST:** —
- **RESPONSE:** `200` `[ProfessionalCredential]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-17.

### `POST /professional-portal/credentials`  — uploadProfessionalCredential
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Carregar uma credencial (multipart).
- **REQUEST:** `ProfessionalCredentialUploadRequest` (multipart)
- **RESPONSE:** `201` `ProfessionalCredential`
- **ERRORS:** `PROFESSIONAL_LOCKED`, `LIMIT_EXCEEDED`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `VALIDATION_ERROR`, `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-17. Auditoria `PROFESSIONAL_CREDENTIAL_UPLOAD` (kind; nunca nº, entidade nem nome do ficheiro).

### `DELETE /professional-portal/credentials/{credentialId}`  — deleteProfessionalCredential
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Remover uma credencial própria.
- **REQUEST:** —
- **RESPONSE:** `204`
- **ERRORS:** `NOT_FOUND`, `PROFESSIONAL_LOCKED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-17. Auditoria `PROFESSIONAL_CREDENTIAL_DELETE`.

### `GET /professional-portal/credentials/{credentialId}/file`  — downloadProfessionalCredential
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Descarregar uma credencial própria (stream mediado).
- **REQUEST:** —
- **RESPONSE:** `200` ficheiro (`application/octet-stream`)
- **ERRORS:** `NOT_FOUND`, `DOCUMENT_NOT_AVAILABLE`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-17. Auditoria `PROFESSIONAL_CREDENTIAL_DOWNLOAD`.

### `POST /professional-portal/submission`  — submitProfessionalForReview
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Submeter o perfil para validação do admin.
- **REQUEST:** —
- **RESPONSE:** `200` `ProfessionalProfile`
- **ERRORS:** `INVALID_STATE_TRANSITION`, `VALIDATION_ERROR` (`errors[]`), `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-15/16. Auditoria `PROFESSIONAL_SUBMIT`.

### `GET /professional-portal/offers`  — listProfessionalOffers
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Listar as próprias ofertas (serviços e preços em Kz).
- **REQUEST:** Query `active?`
- **RESPONSE:** `200` `[ProfessionalOffer]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-24.

### `POST /professional-portal/offers`  — createProfessionalOffer
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Criar uma oferta (especialidade + método + duração + preço em Kz).
- **REQUEST:** `ProfessionalOfferInput`
- **RESPONSE:** `201` `ProfessionalOffer`
- **ERRORS:** `PROFESSIONAL_LOCKED`, `CONFLICT`, `LIMIT_EXCEEDED`, `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-24. Auditoria `PROFESSIONAL_OFFER_CREATE`.

### `PATCH /professional-portal/offers/{offerId}`  — updateProfessionalOffer
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Alterar preço/nota ou ativar/desativar uma oferta.
- **REQUEST:** `ProfessionalOfferPatch`
- **RESPONSE:** `200` `ProfessionalOffer`
- **ERRORS:** `NOT_FOUND`, `PROFESSIONAL_LOCKED`, `CONFLICT`, `LIMIT_EXCEEDED`, `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-03/24/25. Auditoria `PROFESSIONAL_OFFER_UPDATE` (nomes dos campos, nunca preços).

### `GET /professional-portal/schedule-rules`  — listProfessionalScheduleRules
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Listar as regras de horário semanais.
- **REQUEST:** Query `offerId?`, `active?`
- **RESPONSE:** `200` `[ProfessionalScheduleRule]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-25.

### `POST /professional-portal/schedule-rules`  — createProfessionalScheduleRule
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Criar uma regra de horário e gerar os horários das próximas semanas.
- **REQUEST:** `ProfessionalScheduleRuleInput`
- **RESPONSE:** `201` `ProfessionalScheduleRuleResult`
- **ERRORS:** `NOT_FOUND` (oferta de outro profissional), `PROFESSIONAL_LOCKED`, `CONFLICT`, `LIMIT_EXCEEDED`, `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-25. Auditoria `PROFESSIONAL_SCHEDULE_RULE_CREATE`.

### `PATCH /professional-portal/schedule-rules/{ruleId}`  — updateProfessionalScheduleRule
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Alterar ou desativar/reativar uma regra de horário.
- **REQUEST:** `ProfessionalScheduleRulePatch`
- **RESPONSE:** `200` `ProfessionalScheduleRuleResult`
- **ERRORS:** `NOT_FOUND`, `PROFESSIONAL_LOCKED`, `CONFLICT`, `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-25. Auditoria `PROFESSIONAL_SCHEDULE_RULE_UPDATE`.

### `GET /professional-portal/time-off`  — listProfessionalTimeOff
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Listar bloqueios/férias.
- **REQUEST:** Query `from?`, `to?`
- **RESPONSE:** `200` `[ProfessionalTimeOff]`
- **ERRORS:** `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-25.

### `POST /professional-portal/time-off`  — createProfessionalTimeOff
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Criar um bloqueio/férias.
- **REQUEST:** `ProfessionalTimeOffInput`
- **RESPONSE:** `201` `ProfessionalTimeOff`
- **ERRORS:** `PROFESSIONAL_LOCKED`, `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-25. Auditoria `PROFESSIONAL_TIME_OFF_CREATE`.

### `DELETE /professional-portal/time-off/{timeOffId}`  — deleteProfessionalTimeOff
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Remover um bloqueio/férias.
- **REQUEST:** —
- **RESPONSE:** `204`
- **ERRORS:** `NOT_FOUND`, `PROFESSIONAL_LOCKED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-25. Auditoria `PROFESSIONAL_TIME_OFF_DELETE`.

### `GET /professional-portal/slots`  — listProfessionalSlots
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Listar os próprios horários gerados num intervalo.
- **REQUEST:** Query `from`, `to`
- **RESPONSE:** `200` `[ProfessionalSlot]`
- **ERRORS:** `VALIDATION_ERROR`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-25.

### `GET /admin/professionals`  — adminListProfessionals
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Fila e lista de profissionais.
- **REQUEST:** Query `status?`, `category?`, `q?`, `limit?`, `cursor?`
- **RESPONSE:** `200` `{ items: [AdminProfessionalItem], nextCursor }`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-18/27. A leitura da lista não se audita (volume; sem dados de saúde).

### `GET /admin/professionals/{professionalId}`  — adminGetProfessional
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Detalhe de um profissional para validação.
- **REQUEST:** —
- **RESPONSE:** `200` `AdminProfessionalDetail`
- **ERRORS:** `NOT_FOUND`, `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-18/27.

### `POST /admin/professionals/{professionalId}/decisions`  — adminDecideProfessional
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Decidir sobre um profissional (aprovar, rejeitar, pedir informação, suspender, reativar).
- **REQUEST:** `ProfessionalDecisionRequest` (`decision`, `reason?`)
- **RESPONSE:** `200` `AdminProfessionalDetail`
- **ERRORS:** `NOT_FOUND`, `INVALID_STATE_TRANSITION`, `VALIDATION_ERROR`, `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-15/18/19/20. Auditoria `ADMIN_PROFESSIONAL_APPROVE|REJECT|REQUEST_INFO|SUSPEND|REACTIVATE` (`metadata.fromStatus`/`toStatus`; sem o motivo).

### `GET /admin/professionals/{professionalId}/credentials/{credentialId}/file`  — adminDownloadProfessionalCredential
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Descarregar uma credencial para validação (stream mediado).
- **REQUEST:** —
- **RESPONSE:** `200` ficheiro (`application/octet-stream`)
- **ERRORS:** `NOT_FOUND`, `DOCUMENT_NOT_AVAILABLE`, `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-17. Auditoria `ADMIN_PROFESSIONAL_CREDENTIAL_DOWNLOAD` (obrigatória).

### `GET /admin/specialties`  — adminListSpecialties
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Listar o catálogo de especialidades (todas).
- **REQUEST:** —
- **RESPONSE:** `200` `[AdminSpecialty]`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-22.

### `POST /admin/specialties`  — adminCreateSpecialty
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Criar uma especialidade do catálogo.
- **REQUEST:** `SpecialtyInput` (`name`, `category`)
- **RESPONSE:** `201` `AdminSpecialty`
- **ERRORS:** `CONFLICT` (nome duplicado), `VALIDATION_ERROR`, `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-02/22. Auditoria `ADMIN_SPECIALTY_CREATE`.

### `PATCH /admin/specialties/{specialtyId}`  — adminUpdateSpecialty
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Alterar nome ou ativar/desativar uma especialidade.
- **REQUEST:** `SpecialtyPatch` (`name?`, `category?`, `active?`)
- **RESPONSE:** `200` `AdminSpecialty`
- **ERRORS:** `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-22. Auditoria `ADMIN_SPECIALTY_UPDATE`.


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

**Appointment** — `id`: uuid, `memberId`: uuid, `scheduledAt`: datetime, `status`: REQUESTED|SCHEDULED|REJECTED|COMPLETED|NO_SHOW|CANCELLED, `professionalName?`: string, `specialty?`: string, `clinicId?`: uuid, `clinicName?`: string, `slotId?`: uuid (horário de clínica parceira de origem, D17), `responseNote?`: string (motivo da clínica ao recusar/cancelar, D17), `reason?`: string, `notes?`: string, `confirmationStatus`: ConfirmationStatus, `followUpDueOn?`: date (M14 Q) · marco B fatia 1: `processId?`: uuid (só leitura; BR-PRC-01)

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

**ClinicBooking** — `id`: uuid, `status`: REQUESTED|SCHEDULED|REJECTED|COMPLETED|NO_SHOW|CANCELLED, `scheduledAt`: datetime, `specialty?`: string, `professionalName?`: string, `patientName`: string, `notes?`: string, `responseNote?`: string (mínimo necessário, BR-CLN-03 — nunca dados de saúde da família), `source?`: VITA|MANUAL, `clinicPatientId?`: uuid, `slotId?`: uuid (M14 P), `confirmationStatus`, `confirmationSource?`: PATIENT|CLINIC, `dayState`: SCHEDULED|ARRIVED|IN_PROGRESS|COMPLETED|NO_SHOW|CANCELLED|REQUESTED|REJECTED, `arrivedAt?`, `startedAt?`: datetime, `waitingMinutes?`: int, `followUpDueOn?`: date (M14 Q) · M14 R: `receiptId?`: uuid (recibo `ISSUED`; nunca para o Médico) · marco B fatia 1: `processId?`: uuid (só consultas Vita; BR-PRC-06)

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

**ClinicExamBooking** — `id`: uuid, `status`: SCHEDULED|COMPLETED|CANCELLED, `slotId?`: uuid, `scheduledAt`: datetime, `examType?`: string, `professionalName?`: string, `patientName`: string, `notes?`: string, `responseNote?`: string, `resultsCount?`: int, `documents?`: [ClinicDocumentView], `resultsIssuedAt?`: datetime, `receiptId?`: uuid (M14 R; recibo `ISSUED`, nunca para o Médico) (mínimo necessário, BR-CLN-03; nunca os valores dos resultados) · marco B fatia 1: `processId?`: uuid (BR-PRC-06)

**ClinicReceipt** (M14 R) — `id`, `number`: int (apresentar `R-` + 6 dígitos), `bookingKind`: APPOINTMENT|EXAM|VISIT, `bookingId`: uuid, `status`: ISSUED|VOIDED, `paymentMethod`: CASH|CARD|TRANSFER|INSURANCE, `currency`, `totalMinor`: int (cêntimos), `patientName`, `note?`, `issuer`: {`name`, `address?`, `phone?`, `email?`}, `lines`: [`position`, `description`, `amountMinor`, `serviceTypeId?`], `issuedAt`, `issuedByClinicAccountId?`, `voidedAt?`, `voidReason?`, `voidedByClinicAccountId?`, `notice` ("Documento não fiscal — não substitui fatura"), `availableToPatient`: bool

**ClinicReceiptInput** — `bookingKind`, `bookingId`, `paymentMethod`, `lines?`: [{ `serviceTypeId?`, `description?` (1–120), `amountMinor?` (0–10¹¹) }] (1–20; linha de catálogo = `serviceTypeId` com `amountMinor` opcional; livre = `description` + `amountMinor`; omitido ⇒ serviço do horário), `note?` (≤200) · **ClinicReceiptVoidRequest** — `reason` (3–200)

**ClinicReceiptPage** — `items`: [ClinicReceipt], `nextCursor?`, `summary`: {`issuedCount`, `issuedTotalMinor`, `voidedCount`, `currency`}

**FamilyClinicReceipt** — `id`, `number`, `clinicName`, `clinicAddress?`, `clinicPhone?`, `status`, `paymentMethod`, `currency`, `totalMinor`, `patientName`, `note?`, `lines`: [`description`, `amountMinor`], `issuedAt`, `voidedAt?`, `notice` (sem motivo de anulação nem ids da clínica) · **FamilyClinicReceiptPage** — `items`, `nextCursor?`

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

**Process** — `id`: uuid, `memberId`: uuid, `kind`: ROUTINE (aberto), `familyStatus`: SCHEDULED|IN_PROGRESS|DONE|CANCELLED (derivado), `nextStep`: `{ code: AWAIT_CLINIC_RESPONSE|ATTEND|BEING_ATTENDED|RESCHEDULE|NOTHING_PENDING, actor: FAMILY|CLINIC|NONE }` (a UI traduz; conjuntos abertos, clientes toleram valores desconhecidos), `origin`: `{ type: APPOINTMENT|EXAMINATION, id: uuid }`, `scheduledAt?`: datetime|null, `openedAt`: datetime

**ClinicProcess** — `id`: uuid, `kind`: ROUTINE, `origin`: `{ type, id }`, `phase`: PENDING|SCHEDULED|IN_PROGRESS|DONE|CANCELLED|NO_SHOW, `openedAt`: datetime (BR-PRC-06: sem ids Vita, sem `familyStatus`/`nextStep`)

**Examination** — `id`: uuid, `memberId`: uuid, `name`: string, `examDate`: date, `status`: SCHEDULED|COMPLETED|CANCELLED, `scheduledAt?`: datetime, `clinicId?`: uuid, `clinicName?`: string, `slotId?`: uuid, `responseNote?`: string, `notes?`: string, `issuedBy`: FAMILY|CLINIC, `issuedByClinicAccountId?`: uuid, `resultsIssuedAt?`: datetime, `clinicResultNote?`: string, `results`: [ExamResult], `documentIds`: [uuid] · marco B fatia 1: `processId?`: uuid (só leitura; BR-PRC-01)

**ExaminationInput** — `name`: string, `examDate`: date, `clinicId?`: uuid, `clinicName?`: string, `slotId?`: uuid (marcação num horário `EXAM` com vaga; nasce SCHEDULED e name/examDate/clínica são os do horário, BR-EXM-05), `notes?`: string

**ExaminationPatch** — `name?`: string, `examDate?`: date, `clinicId?`: uuid, `clinicName?`: string, `notes?`: string

**ExamStatusRequest** — `status`: SCHEDULED|COMPLETED|CANCELLED (`REQUESTED`/`REJECTED` já não existem na API, ADR-023 revisto)

**UploadDocumentRequest** — `file`: binary, `resourceType`: PRESCRIPTION|EXAMINATION, `resourceId`: uuid

**Document** — `id`: uuid, `resourceType`: PRESCRIPTION|EXAMINATION, `resourceId`: uuid, `originalName`: string, `mimeType`: string, `sizeBytes`: int, `scanStatus`: PENDING|CLEAN|INFECTED, `createdAt`: datetime

**Alert** — `id`: uuid, `type`: MEDICATION_DUE|APPOINTMENT_REMINDER|EXAM_REMINDER|APPOINTMENT_OUTCOME_REQUEST|APPOINTMENT_CONFIRMED|APPOINTMENT_REJECTED|APPOINTMENT_CANCELLED|EXAM_CANCELLED|EXAM_RESULTS_AVAILABLE|RECOMMENDATION_ADDED|APPOINTMENT_CONFIRM_REQUEST|FOLLOWUP_REMINDER|EXAM_ORDER_ADDED|AUTHORIZATION_APPROVED|AUTHORIZATION_NOT_APPROVED|AUTHORIZATION_INFO_REQUESTED|AUTHORIZATION_EXPIRING|AUTHORIZATION_WITHDRAWN (**legado inerte**: os cinco `AUTHORIZATION_*` já não são gerados; ficam só para ler alertas históricos, ADR-037), `familyId`: uuid, `memberId`: uuid, `memberName`: string, `message`: string, `sourceType`: DOSE|APPOINTMENT|EXAMINATION|RECOMMENDATION|PROCESS, `sourceId`: uuid, `triggerAt`: datetime, `readAt?`: datetime

**AdherenceItem** — `planId`: uuid, `medicationName`: string, `taken`: int, `notTaken`: int, `unconfirmed`: int, `pending`: int

**PendingItem** — `type`: UNCONFIRMED_DOSE|APPOINTMENT_OUTCOME|EXAM_OUTCOME, `sourceId`: uuid, `date`: datetime

**MemberReport** — `generatedAt`: datetime, `from`: date, `to`: date, `member`: Member, `bloodType?`: string, `allergies?`: [Allergy], `conditions?`: [Condition], `prescriptions?`: [Prescription], `medicationPlans?`: [MedicationPlan], `adherence?`: [AdherenceItem], `appointments?`: [Appointment], `examinations?`: [Examination]

**FamilyReportMember** — `member`: Member, `allergies?`: [Allergy], `conditions?`: [Condition], `activeMedications?`: [MedicationPlan], `upcomingAppointments?`: [Appointment], `upcomingExaminations?`: [Examination], `pending?`: [PendingItem]

**FamilyReport** — `generatedAt`: datetime, `members`: [FamilyReportMember]

**AdminUserDetail** — `id`: uuid, `email`: email, `name`: string, `status`: PENDING_VERIFICATION|ACTIVE|SUSPENDED, `platformRole`: NONE|PLATFORM_ADMIN, `emailVerifiedAt?`: datetime, `createdAt`: datetime, `suspendedAt?`: datetime, `suspensionReason?`: string, `familiesCount`: int, `activeSessionsCount`: int, `lastSessionUsedAt?`: datetime (BR-ADM-01; nunca saúde)

**AdminClinicAccount** — `id`: uuid, `clinicId`: uuid, `email`: email, `role`: CLINIC_ADMIN|CLINIC_MANAGER|CLINIC_DOCTOR, `status`: ACTIVE|SUSPENDED, `createdAt`: datetime, `lastLoginAt?`: datetime, `suspendedAt?`: datetime (BR-ADM-03)

**AdminUser** — `id`: uuid, `email`: email, `name?`: string, `status`: PENDING_VERIFICATION|ACTIVE|SUSPENDED, `createdAt`: datetime

**SuspendRequest** — `reason`: string

**HealthStatus** — `status`: string


> Total: 212 operações e 195 schemas no `openapi.yaml` (contagem do R6, 2026-11-16; este documento descreve em prosa um subconjunto dos schemas).

### Mercado de profissionais — MK1 (`/professional-portal/*`, `/admin/professionals*`, `/admin/specialties*`)

**ProfessionalValidationStatus** — DRAFT|PENDING_REVIEW|NEEDS_INFO|APPROVED|REJECTED|SUSPENDED

**ProfessionalRegisterRequest** — `email`: email, `password`: string, `termsVersion`: string

**ProfessionalTokenResponse** — `accessToken`: string, `expiresIn`: int, `professionalId`: uuid, `validationStatus`: ProfessionalValidationStatus

**Specialty** — `id`: uuid, `name`: string (2–80), `category`: HEALTH|WELLNESS · **AdminSpecialty** — Specialty + `active`: bool, `professionalCount`: int · **SpecialtyInput** — `name`, `category` · **SpecialtyPatch** — `name?`, `category?` (imutável se em uso), `active?` · **SpecialtyIdsInput** — `specialtyIds`: [uuid] (1–5)

**ProfessionalProfile** — `id`: uuid, `email`: email, `displayName?`: string (2–120), `bio?`: string (≤1000), `city?`: string (2–80), `paymentInstructions?`: string (≤500; nunca público, BR-MKT-26), `validationStatus`, `statusReason?`: string, `statusChangedAt`: datetime, `submittedAt?`, `approvedAt?`, `specialties`: [Specialty], `requirements`: `{ canSubmit: bool, missing: [ProfessionalRequirement] }` · **ProfessionalRequirement** — DISPLAY_NAME|CITY|SPECIALTY|CREDENTIAL_IDENTITY|CREDENTIAL_PROFESSIONAL_LICENSE|CREDENTIAL_CERTIFICATION|CREDENTIAL_SCAN_PENDING|CREDENTIAL_INFECTED|CREDENTIAL_EXPIRED (conjunto aberto) · **ProfessionalProfilePatch** — `displayName?` (só DRAFT/NEEDS_INFO), `bio?`, `city?`, `paymentInstructions?`

**ProfessionalCredential** — `id`: uuid, `kind`: IDENTITY|PROFESSIONAL_LICENSE|CERTIFICATION, `number?`, `issuingBody?`, `validUntil?`: date, `scanStatus`: PENDING|CLEAN|INFECTED, `contentType`: pdf|jpeg|png, `sizeBytes`: int, `createdAt` · **ProfessionalCredentialUploadRequest** (multipart) — `kind`, `number?`, `issuingBody?`, `validUntil?`, `file`

**ProfessionalOffer** — `id`: uuid, `specialtyId`: uuid, `method`: IN_PERSON|VIDEO|CHAT|PHONE, `durationMinutes`: 15|20|30|45|60, `priceKz`: int (0–100 000 000; Kz inteiro), `note?`: string (≤200), `active`: bool · **ProfessionalOfferInput** — `specialtyId`, `method`, `durationMinutes`, `priceKz`, `note?` · **ProfessionalOfferPatch** — `priceKz?`, `note?`, `active?`

**ProfessionalScheduleRule** — `id`, `offerId`, `weekdays`: [1–7], `startTime`/`endTime`: HH:mm (Africa/Luanda), `validFrom?`/`validUntil?`: date, `active` · **ProfessionalScheduleRuleInput** — `offerId`, `weekdays`, `startTime`, `endTime`, `validFrom?`, `validUntil?` · **ProfessionalScheduleRulePatch** — todos exceto `offerId`, + `active?` · **ProfessionalScheduleRuleResult** — `rule`, `generation`: `{ created, unchanged, removed, skippedOverlap, skippedTimeOff }` (só contagens)

**ProfessionalTimeOff** — `id`, `startsAt`, `endsAt`, `reason?` · **ProfessionalTimeOffInput** — `startsAt`, `endsAt`, `reason?` (≤200) · **ProfessionalSlot** — `id`, `offerId`, `startsAt`, `endsAt`

**ValidationCase** — `id`, `action`: SUBMITTED|APPROVED|REJECTED|NEEDS_INFO|SUSPENDED|REACTIVATED|EXPIRED, `fromStatus`, `toStatus`, `actor`: PROFESSIONAL|PLATFORM_ADMIN|SYSTEM, `reason?`, `createdAt`

**AdminProfessionalItem** — `id`, `displayName?`, `email`, `validationStatus`, `submittedAt?`, `specialties`: [Specialty], `credentialCount`: int, `createdAt` · **AdminProfessionalPage** — `{ items, nextCursor? }` · **AdminProfessionalDetail** — `id`, `email`, `emailVerifiedAt?`, `displayName?`, `bio?`, `city?`, `validationStatus`, `statusReason?`, `statusChangedAt`, `submittedAt?`, `approvedAt?`, `specialties`, `credentials`: [ProfessionalCredential], `history`: [ValidationCase] (mais recente primeiro), `createdAt` (nunca dados de saúde, palavra-passe, tokens nem `paymentInstructions`, BR-MKT-18/27) · **ProfessionalDecisionRequest** — `decision`: APPROVE|REJECT|REQUEST_INFO|SUSPEND|REACTIVATE, `reason?` (≤500; obrigatório em REJECT/REQUEST_INFO/SUSPEND)

## Mercado de profissionais — MK2: descoberta, comparação, ranking e conversas (ADR-037) — CONTRATUAL

> Acrescentado 2026-11-17 (contrato de MK2). **Só contrato: nada implementado.** Tags novas `Marketplace` e `Messaging`; as conversas do profissional ficam em `Professional Portal` e a moderação em `Admin`. **25 operações novas** (271 no total): 5 de descoberta (`/marketplace/*`, só `AUTH`, sem família, **sem `AccessPolicy`**: não há dados de saúde), 9 de conversas da família (`/families/{familyId}/members/{memberId}/conversations*`, `AccessPolicy` com a ação nova `MESSAGE_PROFESSIONALS`), 8 de conversas do profissional (`/professional-portal/conversations*`, `professionalBearerAuth`; leitura em todos os estados, escritas só `APPROVED`) e 3 de moderação (`/admin/message-reports*`). Código de erro novo: `CONVERSATION_CLOSED` (`errors.md`). Alertas: `AlertType` + `MESSAGE_RECEIVED`, `AlertSourceType` + `CONVERSATION`. Regras: `business-rules.md` §17 (BR-MKT-32..49); casos de uso `03-use-cases/marketplace.md` (UC-MKT-13..25).

### Descoberta (User autenticado)

### `GET /marketplace/filters`  — getMarketplaceFilters
- **AUTHORIZATION:** AUTH (sem família; `authorization.md` §11.1)
- **DESCRIPTION:** Filtros disponíveis (especialidades ativas com profissionais, cidades, métodos).
- **RESPONSE:** `200` `MarketplaceFilters`
- **ERRORS:** `UNAUTHENTICATED`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-32/33; UC-MKT-13. A `city` a enviar vem daqui (a província não é filtro, OP-82).

### `GET /marketplace/ranking-rules`  — getRankingRules
- **AUTHORIZATION:** AUTH (sem família; `authorization.md` §11.1)
- **DESCRIPTION:** «Como ordenamos»: versão, sinais, pesos e o que nunca é usado.
- **RESPONSE:** `200` `RankingRules`
- **ERRORS:** `UNAUTHENTICATED`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-36/37; UC-MKT-16.

### `GET /marketplace/professionals`  — searchProfessionals
- **AUTHORIZATION:** AUTH (sem família; `authorization.md` §11.1)
- **DESCRIPTION:** Pesquisar profissionais APPROVED com filtros, ordenação e paginação.
- **REQUEST:** Query `q?` (2–60), `specialtyId?`, `category?`, `method?`, `city?`, `minPriceKz?`, `maxPriceKz?`, `availableWithinDays?` (1–56), `sort?` (`RANKING`\|`PRICE_ASC`\|`PRICE_DESC`\|`NEXT_AVAILABLE`), `limit?` (1–50, omissão 20), `cursor?`
- **RESPONSE:** `200` `MarketplaceProfessionalPage` (`items`: `MarketplaceProfessionalItem`, `nextCursor`)
- **ERRORS:** `MALFORMED_REQUEST`, `VALIDATION_ERROR` (`min > max`; `sort=RANKING` sem `specialtyId`), `UNAUTHENTICATED`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-32/33/36/37/49; UC-MKT-13. Filtros de oferta na **mesma** oferta ativa; só `APPROVED` com ≥ 1 oferta que cumpra os filtros; `ranking` só com `specialtyId`; sem registo de pesquisas nem auditoria; logs sem *query string*.

### `GET /marketplace/professionals/compare`  — compareProfessionals
- **AUTHORIZATION:** AUTH (sem família; `authorization.md` §11.1)
- **DESCRIPTION:** Comparar preços de 2–3 profissionais numa especialidade, em Kz.
- **REQUEST:** Query `ids` (2–3 uuid, `form` sem `explode`: `ids=a,b,c`), `specialtyId` (obrigatório)
- **RESPONSE:** `200` `ProfessionalComparison`
- **ERRORS:** `MALFORMED_REQUEST`, `NOT_FOUND` (algum id inexistente/não `APPROVED`: pedido inteiro, sem revelar qual), `VALIDATION_ERROR` (nº de ids, repetidos, profissional sem oferta ativa na especialidade), `UNAUTHENTICATED`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-35; UC-MKT-15. Sem estado no servidor.

### `GET /marketplace/professionals/{professionalId}`  — getMarketplaceProfessional
- **AUTHORIZATION:** AUTH (sem família; `authorization.md` §11.1)
- **DESCRIPTION:** Perfil público de um profissional APPROVED.
- **REQUEST:** Query `specialtyId?` (devolve o `ranking` nessa especialidade)
- **RESPONSE:** `200` `MarketplaceProfessionalProfile`
- **ERRORS:** `NOT_FOUND` (inexistente ou qualquer estado ≠ `APPROVED`), `MALFORMED_REQUEST`, `UNAUTHENTICATED`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-19/34/26; UC-MKT-14. Nunca e-mail, `paymentInstructions` nem credenciais.

### Conversas — lado da família (`/families/{familyId}/members/{memberId}/conversations`)

### `GET /families/{familyId}/members/{memberId}/conversations`  — listFamilyConversations
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `MESSAGE_PROFESSIONALS`, `authorization.md` §11.2)
- **DESCRIPTION:** Listar as conversas do membro com profissionais.
- **REQUEST:** Query `status?` (`OPEN`\|`CLOSED`), `limit?`, `cursor?`
- **RESPONSE:** `200` `FamilyConversationPage`
- **ERRORS:** `MALFORMED_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-38/40/47/48; UC-MKT-18. Não auditado.

### `POST /families/{familyId}/members/{memberId}/conversations`  — startFamilyConversation
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `MESSAGE_PROFESSIONALS`, `authorization.md` §11.2)
- **DESCRIPTION:** Escrever a um profissional: abrir a conversa (ou continuar a existente) com a primeira mensagem.
- **REQUEST:** `StartConversationRequest` (`professionalId`, `participantLabel` 1–40, `text` 1–1000, `clientMessageId?`)
- **RESPONSE:** `201` `ConversationStarted` (criada) · `200` `ConversationStarted` (já existia / `clientMessageId` repetido)
- **ERRORS:** `FORBIDDEN` (`DEPENDENT_SELF`/`OTHER`), `NOT_FOUND` (membro de outra conta; profissional inexistente/não `APPROVED`), `CONVERSATION_CLOSED` (fechada pelo profissional/sistema), `LIMIT_EXCEEDED`, `RATE_LIMITED`, `VALIDATION_ERROR`, `MEMBER_BLOCKED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-38/39/42/46/47; UC-MKT-17. Auditoria `CONVERSATION_START` sem texto nem rótulo. Cria o aviso ao profissional (BR-MKT-41).

### `GET /families/{familyId}/members/{memberId}/conversations/{conversationId}`  — getFamilyConversation
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `MESSAGE_PROFESSIONALS`, `authorization.md` §11.2)
- **DESCRIPTION:** Ver o cabeçalho de uma conversa.
- **RESPONSE:** `200` `FamilyConversation`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-48.

### `GET /families/{familyId}/members/{memberId}/conversations/{conversationId}/messages`  — listFamilyConversationMessages
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `MESSAGE_PROFESSIONALS`, `authorization.md` §11.2)
- **DESCRIPTION:** Mensagens da conversa (`seq` decrescente).
- **REQUEST:** Query `limit?`, `cursor?`
- **RESPONSE:** `200` `ChatMessagePage`
- **ERRORS:** `MALFORMED_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-39/40/44/46. Mensagens ocultas: `hidden=true`, sem texto. Ler **não** marca como lido. Não auditado.

### `POST /families/{familyId}/members/{memberId}/conversations/{conversationId}/messages`  — sendFamilyMessage
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `MESSAGE_PROFESSIONALS`, `authorization.md` §11.2)
- **DESCRIPTION:** Enviar uma mensagem de texto.
- **REQUEST:** `SendMessageRequest` (`text` 1–1000, `clientMessageId?`)
- **RESPONSE:** `201` `ChatMessage` · `200` (idempotência)
- **ERRORS:** `CONVERSATION_CLOSED`, `LIMIT_EXCEEDED` (4.ª seguida sem resposta), `RATE_LIMITED`, `VALIDATION_ERROR`, `MEMBER_BLOCKED`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-39/41/42/47; UC-MKT-18. Mensagens não se auditam.

### `PUT /families/{familyId}/members/{memberId}/conversations/{conversationId}/read`  — markFamilyConversationRead
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `MESSAGE_PROFESSIONALS`, `authorization.md` §11.2)
- **DESCRIPTION:** Marcar como lida (marcador do lado da família; também marca os alertas `MESSAGE_RECEIVED`).
- **REQUEST:** `MarkReadRequest` (`upToSeq?`)
- **RESPONSE:** `200` `FamilyConversation`
- **ERRORS:** `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-40/41. Idempotente; nunca recua.

### `POST /families/{familyId}/members/{memberId}/conversations/{conversationId}/close`  — closeFamilyConversation
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `MESSAGE_PROFESSIONALS`, `authorization.md` §11.2)
- **DESCRIPTION:** Fechar a conversa.
- **RESPONSE:** `200` `FamilyConversation`
- **ERRORS:** `INVALID_STATE_TRANSITION`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-43; UC-MKT-22. Auditoria `CONVERSATION_CLOSE`.

### `POST /families/{familyId}/members/{memberId}/conversations/{conversationId}/reopen`  — reopenFamilyConversation
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `MESSAGE_PROFESSIONALS`, `authorization.md` §11.2)
- **DESCRIPTION:** Reabrir uma conversa que a própria família fechou.
- **RESPONSE:** `200` `FamilyConversation`
- **ERRORS:** `INVALID_STATE_TRANSITION` (aberta), `CONVERSATION_CLOSED` (fechada pelo profissional/sistema), `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-43. Auditoria `CONVERSATION_REOPEN`.

### `POST /families/{familyId}/members/{memberId}/conversations/{conversationId}/messages/{messageId}/reports`  — reportFamilyMessage
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `MESSAGE_PROFESSIONALS`, `authorization.md` §11.2)
- **DESCRIPTION:** Denunciar uma mensagem do profissional.
- **REQUEST:** `ReportMessageRequest` (`reason`, `note?` ≤ 300)
- **RESPONSE:** `201` `MessageReportReceipt` · `200` (já existia)
- **ERRORS:** `VALIDATION_ERROR` (mensagem própria), `RATE_LIMITED`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-44; UC-MKT-23. Auditoria `MESSAGE_REPORT_CREATE` sem texto nem nota.

### Conversas — lado do profissional (`/professional-portal/conversations`)

### `GET /professional-portal/conversations`  — listProfessionalConversations
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Listar as conversas do profissional.
- **REQUEST:** Query `status?`, `limit?`, `cursor?`
- **RESPONSE:** `200` `ProfessionalConversationPage`
- **ERRORS:** `MALFORMED_REQUEST`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-38/40/47/48; UC-MKT-20. **Sem ids de família/membro/utilizador** (só `participantLabel`).

### `GET /professional-portal/conversations/{conversationId}`  — getProfessionalConversation
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Ver uma conversa.
- **RESPONSE:** `200` `ProfessionalConversation`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-48.

### `GET /professional-portal/conversations/{conversationId}/messages`  — listProfessionalConversationMessages
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Mensagens da conversa.
- **REQUEST:** Query `limit?`, `cursor?`
- **RESPONSE:** `200` `ChatMessagePage`
- **ERRORS:** `MALFORMED_REQUEST`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-39/44. Leitura em todos os estados de validação.

### `POST /professional-portal/conversations/{conversationId}/messages`  — sendProfessionalMessage
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Responder numa conversa.
- **REQUEST:** `SendMessageRequest`
- **RESPONSE:** `201` `ChatMessage` · `200` (idempotência)
- **ERRORS:** `PROFESSIONAL_LOCKED` (não `APPROVED`), `CONVERSATION_CLOSED`, `RATE_LIMITED`, `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-39/41/42/47. Cria o alerta `MESSAGE_RECEIVED` da família.

### `PUT /professional-portal/conversations/{conversationId}/read`  — markProfessionalConversationRead
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Marcar como lida (lado do profissional).
- **REQUEST:** `MarkReadRequest`
- **RESPONSE:** `200` `ProfessionalConversation`
- **ERRORS:** `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-40. Permitido em todos os estados.

### `POST /professional-portal/conversations/{conversationId}/close`  — closeProfessionalConversation
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Fechar a conversa.
- **RESPONSE:** `200` `ProfessionalConversation`
- **ERRORS:** `PROFESSIONAL_LOCKED`, `INVALID_STATE_TRANSITION`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-43. Auditoria `PROFESSIONAL_CONVERSATION_CLOSE`.

### `POST /professional-portal/conversations/{conversationId}/reopen`  — reopenProfessionalConversation
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Reabrir uma conversa que o próprio profissional fechou.
- **RESPONSE:** `200` `ProfessionalConversation`
- **ERRORS:** `PROFESSIONAL_LOCKED`, `INVALID_STATE_TRANSITION`, `CONVERSATION_CLOSED`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-43. Auditoria `PROFESSIONAL_CONVERSATION_REOPEN`.

### `POST /professional-portal/conversations/{conversationId}/messages/{messageId}/reports`  — reportProfessionalMessage
- **AUTHORIZATION:** PROFESSIONAL_ACCOUNT
- **DESCRIPTION:** Denunciar uma mensagem da família.
- **REQUEST:** `ReportMessageRequest`
- **RESPONSE:** `201` `MessageReportReceipt` · `200`
- **ERRORS:** `VALIDATION_ERROR`, `RATE_LIMITED`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-44. Permitido em todos os estados. Auditoria `PROFESSIONAL_MESSAGE_REPORT_CREATE`.

### Moderação (`/admin/message-reports`)

### `GET /admin/message-reports`  — adminListMessageReports
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Fila de denúncias.
- **REQUEST:** Query `status?` (omissão `OPEN`), `limit?`, `cursor?`
- **RESPONSE:** `200` `AdminMessageReportPage`
- **ERRORS:** `MALFORMED_REQUEST`, `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-44; UC-MKT-24. **Sem o texto** das mensagens.

### `GET /admin/message-reports/{reportId}`  — adminGetMessageReport
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Detalhe de uma denúncia: a mensagem denunciada, até 2 mensagens de contexto (as imediatamente anteriores da mesma conversa, `contextBefore`) e o motivo.
- **RESPONSE:** `200` `AdminMessageReportDetail`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-44/48. **Auditado** (`ADMIN_MESSAGE_REPORT_VIEW`, sem texto; `metadata.contextCount`). Nunca família, membro, `participantLabel` nem mais mensagens do que a denunciada + 2 anteriores (OP-76).

### `POST /admin/message-reports/{reportId}/decisions`  — adminDecideMessageReport
- **AUTHORIZATION:** PLATFORM_ADMIN
- **DESCRIPTION:** Decidir (arquivar, ocultar a mensagem, ocultar e fechar a conversa).
- **REQUEST:** `MessageReportDecisionRequest` (`decision`: `DISMISS`\|`HIDE_MESSAGE`\|`HIDE_AND_CLOSE`)
- **RESPONSE:** `200` `AdminMessageReportDetail`
- **ERRORS:** `INVALID_STATE_TRANSITION` (já decidida), `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-44. Transação única com bloqueio da denúncia. Auditoria `ADMIN_MESSAGE_REPORT_DECIDE` (`decision`). A resposta repete o detalhe com o mesmo limite (denunciada + 2).

### Schemas de MK2 (resumo; detalhe em `openapi.yaml`)

**MarketplaceOffer** — `id`, `specialtyId`, `method`, `durationMinutes`, `priceKz`: int (Kz), `note?` · **RankingExplanation** — `version` (`v1`), `score`: 0–100, `signals`: {`profileCompleteness`, `availability`, `price`, `seniority`} (0–1), `reasons`: [`COMPLETE_PROFILE`\|`GOOD_AVAILABILITY`\|`COMPETITIVE_PRICE`\|`ESTABLISHED`] (≤ 3), `label`: `NEW` · **MarketplaceProfessionalItem** — `id`, `displayName`, `city`, `specialties`, `matchingOffers`, `fromPriceKz`, `nextAvailableAt?`, `ranking?` · **MarketplaceProfessionalProfile** — `id`, `displayName`, `bio?`, `city`, `specialties`, `offers`, `nextAvailableAt?`, `memberSince`: date, `ranking?` (nunca e-mail, pagamento, credenciais, estado) · **ProfessionalComparison** — `specialtyId`, `items`: [`ComparisonItem`: `professionalId`, `displayName`, `city`, `offers`, `fromPriceKz`, `nextAvailableAt?`], `priceSummary`: [`method`, `minPriceKz`, `maxPriceKz`, `cheapestProfessionalIds`] · **MarketplaceFilters** — `specialties`: [`id`, `name`, `category`, `professionalCount`], `cities`: [`name`, `professionalCount`], `methods` · **RankingRules** — `version`, `signals`: [`code`, `weightPercent`, `description`], `notUsed`, `statement`

**FamilyConversation** — `id`, `memberId`, `professional`: {`id`, `displayName`, `city?`}, `participantLabel`, `status`: OPEN|CLOSED, `closedBy?`: FAMILY|PROFESSIONAL|SYSTEM, `canSend` (derivado), `lastMessageAt`, `unreadCount`, `createdAt` · **ProfessionalConversation** — o mesmo **sem** `memberId` nem `professional` (nunca ids de família/membro/utilizador) · **ChatMessage** — `id`, `seq`, `side`: FAMILY|PROFESSIONAL, `mine`, `text?` (nulo se `hidden`), `hidden`, `createdAt`, `readByOtherSide` (nunca o id de quem escreveu) · **StartConversationRequest** — `professionalId`, `participantLabel`, `text`, `clientMessageId?` · **ConversationStarted** — `conversation`, `message` · **SendMessageRequest** — `text`, `clientMessageId?` · **MarkReadRequest** — `upToSeq?` · **ReportMessageRequest** — `reason`: ABUSE|SPAM|SCAM_OR_OFF_PLATFORM_PAYMENT|SENSITIVE_DATA|OTHER, `note?` · **MessageReportReceipt** — `id`, `status`: OPEN|DECIDED, `reason`, `createdAt` · **AdminMessageReportItem** — `id`, `status`, `reason`, `reportedSide`, `professionalId`, `professionalDisplayName`, `createdAt` · **AdminMessageReportDetail** — `id`, `status`, `reason`, `note?`, `reportedSide`, `professional`, `reportedUserId?`, `message`: {`id`, `text`, `hidden`, `createdAt`}, `contextBefore`: [`AdminReportContextMessage`: `id`, `seq`, `side`, `text?` (nulo se oculta), `hidden`, `createdAt`] (≤ 2), `decision?`, `decidedAt?`, `createdAt` · **MessageReportDecisionRequest** — `decision`: DISMISS|HIDE_MESSAGE|HIDE_AND_CLOSE · **Páginas** — `{ items, nextCursor? }`


## Mercado de profissionais — MK3: marcação, comprovativo e avaliações (ADR-037) — CONTRATUAL

> Acrescentado 2026-11-19 (contrato de MK3). **Só contrato: nada implementado.** Tag nova `Bookings` (rotas da família; as do profissional ficam em `Professional Portal`, as do admin em `Admin`, as públicas em `Marketplace`). **31 operações novas** (302 no total): 2 públicas (`/marketplace/professionals/{id}/slots` e `…/reviews`, só `AUTH`, sem `AccessPolicy`), 10 da família (`/families/{familyId}/members/{memberId}/bookings*`, ação nova `BOOK_PROFESSIONALS`), 12 do profissional (`/professional-portal/bookings*` e `/professional-portal/reviews*`, `professionalBearerAuth`; leitura em todos os estados, escritas só `APPROVED`) e 7 do admin (`/admin/payment-disputes*`, `/admin/review-reports*`). **Alterações a operações existentes (aditivas, sem mudar as de MK1/MK2):** `GET /professional-portal/slots` devolve `booked`/`bookingId`; `POST /professional-portal/time-off` pode devolver `409 CONFLICT` (BR-MKT-53); `Appointment.bookingId?`; `Process.origin.type=BOOKING` e novos `nextStep.code`/`actor`; `RankingExplanation`/`RankingSignals`/`RankingRules` passam a `v2` (sinal `reviews`, `label` `NEW`\|`RATED`, razão `GOOD_REVIEWS`); `reviewSummary` no cartão e no perfil público; `AlertType` + `BOOKING_UPDATED`, `PAYMENT_UPDATED`; `AlertSourceType` + `BOOKING`. Códigos de erro novos: `SLOT_UNAVAILABLE`, `SELF_BOOKING_NOT_ALLOWED`, `REVIEW_NOT_ALLOWED` (`errors.md`). Regras: `business-rules.md` §17 (BR-MKT-50..66); casos de uso `03-use-cases/consultations.md` (UC-MKT-26..47).

### `GET /marketplace/professionals/{professionalId}/slots`  — listBookableSlots
- **AUTHORIZATION:** AUTH (sem família; `authorization.md` §11.1/§12.4)
- **DESCRIPTION:** Horários futuros livres de uma oferta ativa de um profissional `APPROVED`.
- **REQUEST:** Query `offerId` (obrigatório), `from?`, `to?` (máx. 62 dias; omissão: 14 dias)
- **RESPONSE:** `200` `[BookableSlot]`
- **ERRORS:** `MALFORMED_REQUEST`, `UNAUTHENTICATED`, `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-53; UC-MKT-26. Não auditado.

### `GET /marketplace/professionals/{professionalId}/reviews`  — listProfessionalReviews
- **AUTHORIZATION:** AUTH (sem família; `authorization.md` §11.1/§12.4)
- **DESCRIPTION:** Avaliações verificadas (anónimas) e resumo.
- **REQUEST:** Query `specialtyId?`, `limit?`, `cursor?`
- **RESPONSE:** `200` `PublicReviewPage`
- **ERRORS:** `MALFORMED_REQUEST`, `UNAUTHENTICATED`, `NOT_FOUND`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-59/60/63; UC-MKT-40. Não auditado.

### `GET /families/{familyId}/members/{memberId}/bookings`  — listFamilyBookings
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `BOOK_PROFESSIONALS`, `authorization.md` §12.1)
- **DESCRIPTION:** Listar as marcações do membro.
- **REQUEST:** Query `status?`, `limit?`, `cursor?`
- **RESPONSE:** `200` `FamilyBookingPage`
- **ERRORS:** `MALFORMED_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `MEMBER_BLOCKED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-50/55; UC-MKT-28. Não auditado.

### `POST /families/{familyId}/members/{memberId}/bookings`  — createBooking
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `BOOK_PROFESSIONALS`, `authorization.md` §12.1)
- **DESCRIPTION:** Marcar uma consulta (reserva atómica do horário; abre o `Process` `BOOKING`).
- **REQUEST:** `CreateBookingRequest` (`offerId`, `slotId`, `participantLabel` 1–40, `clientRequestId?`); **sem motivo em texto livre**
- **RESPONSE:** `201` `FamilyBooking` · `200` (clientRequestId repetido)
- **ERRORS:** `MALFORMED_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `MEMBER_BLOCKED`, `SLOT_UNAVAILABLE`, `CONFLICT`, `LIMIT_EXCEEDED`, `SELF_BOOKING_NOT_ALLOWED`, `VALIDATION_ERROR`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-51/53/55/62/66; UC-MKT-27. Auditoria `BOOKING_CREATE`.

### `GET /families/{familyId}/members/{memberId}/bookings/{bookingId}`  — getFamilyBooking
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `BOOK_PROFESSIONALS`, `authorization.md` §12.1)
- **DESCRIPTION:** Ver uma marcação (instruções de pagamento e `meetingInfo` só a partir de `CONFIRMED`).
- **REQUEST:** —
- **RESPONSE:** `200` `FamilyBooking`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `MEMBER_BLOCKED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-50/52/56; UC-MKT-28. Não auditado.

### `POST /families/{familyId}/members/{memberId}/bookings/{bookingId}/cancel`  — cancelFamilyBooking
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `BOOK_PROFESSIONALS`, `authorization.md` §12.1)
- **DESCRIPTION:** Cancelar uma marcação antes da hora.
- **REQUEST:** `CancelBookingRequest` (`note?` ≤ 300)
- **RESPONSE:** `200` `FamilyBooking`
- **ERRORS:** `MALFORMED_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `MEMBER_BLOCKED`, `INVALID_STATE_TRANSITION`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-MKT-52/53/55; UC-MKT-29. Auditoria `BOOKING_CANCEL`.

### `GET /families/{familyId}/members/{memberId}/bookings/{bookingId}/payment-proofs`  — listFamilyPaymentProofs
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `BOOK_PROFESSIONALS`, `authorization.md` §12.1)
- **DESCRIPTION:** Metadados dos comprovativos da marcação.
- **REQUEST:** —
- **RESPONSE:** `200` `[PaymentProof]`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `MEMBER_BLOCKED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-57; UC-MKT-35. Não auditado.

### `POST /families/{familyId}/members/{memberId}/bookings/{bookingId}/payment-proofs`  — uploadPaymentProof
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `BOOK_PROFESSIONALS`, `authorization.md` §12.1)
- **DESCRIPTION:** Carregar o comprovativo (multipart; quarentena + antivírus).
- **REQUEST:** `PaymentProofUploadRequest` (`file` PDF/JPG/PNG ≤ 10 MB)
- **RESPONSE:** `201` `PaymentProof`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `MEMBER_BLOCKED`, `INVALID_STATE_TRANSITION`, `LIMIT_EXCEEDED`, `CONFLICT`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `VALIDATION_ERROR`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-56/57/66; UC-MKT-35. Auditoria `PAYMENT_PROOF_UPLOAD`.

### `GET /families/{familyId}/members/{memberId}/bookings/{bookingId}/payment-proofs/{proofId}/file`  — downloadFamilyPaymentProof
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `BOOK_PROFESSIONALS`, `authorization.md` §12.1)
- **DESCRIPTION:** Descarregar um comprovativo próprio (stream mediado, `no-store`).
- **REQUEST:** —
- **RESPONSE:** `200` binário
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `MEMBER_BLOCKED`, `DOCUMENT_NOT_AVAILABLE`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-57. **Todo** o download é auditado (`PAYMENT_PROOF_DOWNLOAD`).

### `POST /families/{familyId}/members/{memberId}/bookings/{bookingId}/payment-proofs/{proofId}/dispute`  — disputePaymentProof
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `BOOK_PROFESSIONALS`, `authorization.md` §12.1)
- **DESCRIPTION:** Disputar um comprovativo rejeitado (uma vez).
- **REQUEST:** `DisputePaymentProofRequest` (`note?` ≤ 300)
- **RESPONSE:** `200` `PaymentProof`
- **ERRORS:** `MALFORMED_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `MEMBER_BLOCKED`, `INVALID_STATE_TRANSITION`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-MKT-58; UC-MKT-37. Auditoria `PAYMENT_PROOF_DISPUTE`.

### `GET /families/{familyId}/members/{memberId}/bookings/{bookingId}/review`  — getFamilyBookingReview
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `BOOK_PROFESSIONALS`, `authorization.md` §12.1)
- **DESCRIPTION:** Ver a avaliação própria da marcação.
- **REQUEST:** —
- **RESPONSE:** `200` `FamilyReview`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `MEMBER_BLOCKED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-59; UC-MKT-39. Não auditado.

### `PUT /families/{familyId}/members/{memberId}/bookings/{bookingId}/review`  — putFamilyBookingReview
- **AUTHORIZATION:** `SELF`/`TUTOR_OF` do membro (ação `BOOK_PROFESSIONALS`, `authorization.md` §12.1)
- **DESCRIPTION:** Avaliar (criar ou editar até 7 dias) — só com consulta `COMPLETED` e pagamento satisfeito, até 30 dias.
- **REQUEST:** `ReviewInput` (`rating` 1–5, `comment?` ≤ 500)
- **RESPONSE:** `201` `FamilyReview` (criada) · `200` (editada)
- **ERRORS:** `MALFORMED_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `MEMBER_BLOCKED`, `REVIEW_NOT_ALLOWED`, `SELF_BOOKING_NOT_ALLOWED`, `VALIDATION_ERROR`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-59/62/66; UC-MKT-39. Auditoria `REVIEW_CREATE`/`REVIEW_UPDATE` (sem texto).

### `GET /professional-portal/bookings`  — listProfessionalBookings
- **AUTHORIZATION:** `PROFESSIONAL_ACCOUNT` (`authorization.md` §10/§12.2; escritas só `APPROVED`)
- **DESCRIPTION:** Listar as marcações do profissional (só o rótulo do participante).
- **REQUEST:** Query `status?`, `from?`, `to?`, `limit?`, `cursor?`
- **RESPONSE:** `200` `ProfessionalBookingPage`
- **ERRORS:** `MALFORMED_REQUEST`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-50/63; UC-MKT-30. Leitura em todos os estados. Não auditado.

### `GET /professional-portal/bookings/{bookingId}`  — getProfessionalBooking
- **AUTHORIZATION:** `PROFESSIONAL_ACCOUNT` (`authorization.md` §10/§12.2; escritas só `APPROVED`)
- **DESCRIPTION:** Ver uma marcação.
- **REQUEST:** —
- **RESPONSE:** `200` `ProfessionalBooking`
- **ERRORS:** `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-63; UC-MKT-30.

### `POST /professional-portal/bookings/{bookingId}/confirm`  — confirmBooking
- **AUTHORIZATION:** `PROFESSIONAL_ACCOUNT` (`authorization.md` §10/§12.2; escritas só `APPROVED`)
- **DESCRIPTION:** Confirmar (cria a consulta no membro; `meetingInfo` obrigatório em `VIDEO`/`PHONE`).
- **REQUEST:** `ConfirmBookingRequest` (`meetingInfo?` ≤ 300)
- **RESPONSE:** `200` `ProfessionalBooking`
- **ERRORS:** `MALFORMED_REQUEST`, `NOT_FOUND`, `PROFESSIONAL_LOCKED`, `INVALID_STATE_TRANSITION`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-MKT-52/55/65; UC-MKT-31. Auditoria `PROFESSIONAL_BOOKING_CONFIRM`.

### `POST /professional-portal/bookings/{bookingId}/reject`  — rejectBooking
- **AUTHORIZATION:** `PROFESSIONAL_ACCOUNT` (`authorization.md` §10/§12.2; escritas só `APPROVED`)
- **DESCRIPTION:** Recusar um pedido (motivo obrigatório; liberta o horário).
- **REQUEST:** `RejectBookingRequest` (`reason` ≤ 300)
- **RESPONSE:** `200` `ProfessionalBooking`
- **ERRORS:** `MALFORMED_REQUEST`, `NOT_FOUND`, `PROFESSIONAL_LOCKED`, `INVALID_STATE_TRANSITION`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-MKT-52/53; UC-MKT-31. Auditoria `PROFESSIONAL_BOOKING_REJECT`.

### `POST /professional-portal/bookings/{bookingId}/cancel`  — cancelProfessionalBooking
- **AUTHORIZATION:** `PROFESSIONAL_ACCOUNT` (`authorization.md` §10/§12.2; escritas só `APPROVED`)
- **DESCRIPTION:** Cancelar antes da hora (motivo obrigatório).
- **REQUEST:** `RejectBookingRequest` (`reason` ≤ 300)
- **RESPONSE:** `200` `ProfessionalBooking`
- **ERRORS:** `MALFORMED_REQUEST`, `NOT_FOUND`, `PROFESSIONAL_LOCKED`, `INVALID_STATE_TRANSITION`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-MKT-52/53/55; UC-MKT-32. Auditoria `PROFESSIONAL_BOOKING_CANCEL`.

### `POST /professional-portal/bookings/{bookingId}/complete`  — completeBooking
- **AUTHORIZATION:** `PROFESSIONAL_ACCOUNT` (`authorization.md` §10/§12.2; escritas só `APPROVED`)
- **DESCRIPTION:** Marcar concluída (só com `agora ≥ startsAt`).
- **REQUEST:** —
- **RESPONSE:** `200` `ProfessionalBooking`
- **ERRORS:** `NOT_FOUND`, `PROFESSIONAL_LOCKED`, `INVALID_STATE_TRANSITION`
- **BUSINESS RULES:** BR-MKT-52/55/59; UC-MKT-33. Auditoria `PROFESSIONAL_BOOKING_COMPLETE`.

### `POST /professional-portal/bookings/{bookingId}/no-show`  — markBookingNoShow
- **AUTHORIZATION:** `PROFESSIONAL_ACCOUNT` (`authorization.md` §10/§12.2; escritas só `APPROVED`)
- **DESCRIPTION:** Marcar falta (só com `agora ≥ startsAt`).
- **REQUEST:** —
- **RESPONSE:** `200` `ProfessionalBooking`
- **ERRORS:** `NOT_FOUND`, `PROFESSIONAL_LOCKED`, `INVALID_STATE_TRANSITION`
- **BUSINESS RULES:** BR-MKT-52/55; UC-MKT-33. Auditoria `PROFESSIONAL_BOOKING_NO_SHOW`.

### `GET /professional-portal/bookings/{bookingId}/payment-proofs/{proofId}/file`  — downloadProfessionalPaymentProof
- **AUTHORIZATION:** `PROFESSIONAL_ACCOUNT` (`authorization.md` §10/§12.2; escritas só `APPROVED`)
- **DESCRIPTION:** Descarregar o comprovativo da própria marcação (`no-store`; só `CLEAN`).
- **REQUEST:** —
- **RESPONSE:** `200` binário
- **ERRORS:** `NOT_FOUND`, `DOCUMENT_NOT_AVAILABLE`, `RATE_LIMITED`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-57; UC-MKT-36. **Todo** o download é auditado (`PROFESSIONAL_PAYMENT_PROOF_DOWNLOAD`). Leitura em todos os estados.

### `POST /professional-portal/bookings/{bookingId}/payment-proofs/{proofId}/decision`  — decidePaymentProof
- **AUTHORIZATION:** `PROFESSIONAL_ACCOUNT` (`authorization.md` §10/§12.2; escritas só `APPROVED`)
- **DESCRIPTION:** Confirmar ou rejeitar o comprovativo.
- **REQUEST:** `ProofDecisionRequest` (`decision` `CONFIRM`\|`REJECT`, `reason` obrigatório em `REJECT`)
- **RESPONSE:** `200` `PaymentProof`
- **ERRORS:** `MALFORMED_REQUEST`, `NOT_FOUND`, `PROFESSIONAL_LOCKED`, `INVALID_STATE_TRANSITION`, `DOCUMENT_NOT_AVAILABLE`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-MKT-57/58/65; UC-MKT-36. Auditoria `PROFESSIONAL_PAYMENT_PROOF_DECIDE`.

### `GET /professional-portal/reviews`  — listProfessionalReviewsOwn
- **AUTHORIZATION:** `PROFESSIONAL_ACCOUNT` (`authorization.md` §10/§12.2; escritas só `APPROVED`)
- **DESCRIPTION:** Listar as avaliações recebidas (anónimas).
- **REQUEST:** Query `unanswered?`, `limit?`, `cursor?`
- **RESPONSE:** `200` `ProfessionalReviewPage`
- **ERRORS:** `MALFORMED_REQUEST`, `UNAUTHENTICATED`
- **BUSINESS RULES:** BR-MKT-59/60; UC-MKT-41. Leitura em todos os estados.

### `POST /professional-portal/reviews/{reviewId}/reply`  — replyToReview
- **AUTHORIZATION:** `PROFESSIONAL_ACCOUNT` (`authorization.md` §10/§12.2; escritas só `APPROVED`)
- **DESCRIPTION:** Responder uma vez a uma avaliação.
- **REQUEST:** `ReviewReplyRequest` (`text` 1–500)
- **RESPONSE:** `201` `ProfessionalReview`
- **ERRORS:** `MALFORMED_REQUEST`, `NOT_FOUND`, `PROFESSIONAL_LOCKED`, `CONFLICT`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-MKT-60; UC-MKT-41. Auditoria `PROFESSIONAL_REVIEW_REPLY` (sem texto).

### `POST /professional-portal/reviews/{reviewId}/reports`  — reportReview
- **AUTHORIZATION:** `PROFESSIONAL_ACCOUNT` (`authorization.md` §10/§12.2; escritas só `APPROVED`)
- **DESCRIPTION:** Denunciar uma avaliação (uma por avaliação).
- **REQUEST:** `ReviewReportRequest` (`reason`, `note?` ≤ 300)
- **RESPONSE:** `201` `ReviewReport` · `200` (já existia)
- **ERRORS:** `MALFORMED_REQUEST`, `NOT_FOUND`, `PROFESSIONAL_LOCKED`, `VALIDATION_ERROR`, `RATE_LIMITED`
- **BUSINESS RULES:** BR-MKT-60/66; UC-MKT-42. Auditoria `PROFESSIONAL_REVIEW_REPORT_CREATE`.

### `GET /admin/payment-disputes`  — adminListPaymentDisputes
- **AUTHORIZATION:** `PLATFORM_ADMIN` (`authorization.md` §12.3)
- **DESCRIPTION:** Fila de disputas (sem ficheiros nem textos livres).
- **REQUEST:** Query `status?` (omissão `DISPUTED`), `limit?`, `cursor?`
- **RESPONSE:** `200` `AdminPaymentDisputePage`
- **ERRORS:** `MALFORMED_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`
- **BUSINESS RULES:** BR-MKT-58/63; UC-MKT-38.

### `GET /admin/payment-disputes/{proofId}`  — adminGetPaymentDispute
- **AUTHORIZATION:** `PLATFORM_ADMIN` (`authorization.md` §12.3)
- **DESCRIPTION:** Detalhe: a marcação e o comprovativo (metadados) — **só** isto.
- **REQUEST:** —
- **RESPONSE:** `200` `AdminPaymentDisputeDetail`
- **ERRORS:** `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`
- **BUSINESS RULES:** BR-MKT-58/63; UC-MKT-38. **Toda** a abertura é auditada (`ADMIN_PAYMENT_DISPUTE_VIEW`).

### `GET /admin/payment-disputes/{proofId}/file`  — adminDownloadPaymentProof
- **AUTHORIZATION:** `PLATFORM_ADMIN` (`authorization.md` §12.3)
- **DESCRIPTION:** Descarregar o comprovativo de uma disputa (`no-store`).
- **REQUEST:** —
- **RESPONSE:** `200` binário
- **ERRORS:** `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `DOCUMENT_NOT_AVAILABLE`
- **BUSINESS RULES:** BR-MKT-57/58. **Todo** o download é auditado (`ADMIN_PAYMENT_PROOF_DOWNLOAD`).

### `POST /admin/payment-disputes/{proofId}/decisions`  — adminDecidePaymentDispute
- **AUTHORIZATION:** `PLATFORM_ADMIN` (`authorization.md` §12.3)
- **DESCRIPTION:** Decidir: `CONFIRM_PAYMENT` ou `UPHOLD_REJECTION`.
- **REQUEST:** `AdminPaymentDisputeDecisionRequest`
- **RESPONSE:** `200` `AdminPaymentDisputeDetail`
- **ERRORS:** `MALFORMED_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE_TRANSITION`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-MKT-58; UC-MKT-38. Auditoria `ADMIN_PAYMENT_DISPUTE_DECIDE`.

### `GET /admin/review-reports`  — adminListReviewReports
- **AUTHORIZATION:** `PLATFORM_ADMIN` (`authorization.md` §12.3)
- **DESCRIPTION:** Fila de denúncias de avaliações (sem comentário).
- **REQUEST:** Query `status?` (omissão `OPEN`), `limit?`, `cursor?`
- **RESPONSE:** `200` `AdminReviewReportPage`
- **ERRORS:** `MALFORMED_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`
- **BUSINESS RULES:** BR-MKT-60/63; UC-MKT-43.

### `GET /admin/review-reports/{reportId}`  — adminGetReviewReport
- **AUTHORIZATION:** `PLATFORM_ADMIN` (`authorization.md` §12.3)
- **DESCRIPTION:** Detalhe: só a avaliação denunciada, o profissional e o motivo.
- **REQUEST:** —
- **RESPONSE:** `200` `AdminReviewReportDetail`
- **ERRORS:** `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`
- **BUSINESS RULES:** BR-MKT-60/63; UC-MKT-43. **Toda** a abertura é auditada (`ADMIN_REVIEW_REPORT_VIEW`).

### `POST /admin/review-reports/{reportId}/decisions`  — adminDecideReviewReport
- **AUTHORIZATION:** `PLATFORM_ADMIN` (`authorization.md` §12.3)
- **DESCRIPTION:** Decidir: `DISMISS` ou `HIDE_COMMENT` (a nota continua a contar).
- **REQUEST:** `AdminReviewReportDecisionRequest`
- **RESPONSE:** `200` `AdminReviewReportDetail`
- **ERRORS:** `MALFORMED_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE_TRANSITION`, `VALIDATION_ERROR`
- **BUSINESS RULES:** BR-MKT-60; UC-MKT-43. Auditoria `ADMIN_REVIEW_REPORT_DECIDE`.

### Schemas de MK3 (resumo; detalhe em `openapi.yaml`)

**BookingStatus** — REQUESTED|CONFIRMED|REJECTED|CANCELLED|COMPLETED|NO_SHOW · **BookingPaymentStatus** — NOT_REQUIRED|AWAITING_PROOF|PROOF_SUBMITTED|CONFIRMED|REJECTED|DISPUTED · **BookableSlot** — `id`, `offerId`, `startsAt`, `endsAt` · **CreateBookingRequest** — `offerId`, `slotId`, `participantLabel` (1–40), `clientRequestId?` (**sem motivo**) · **FamilyBooking** — `id`, `memberId`, `professional` {`id`, `displayName`, `city?`}, `offer` {`specialtyId`, `specialtyName`, `category`, `method`, `durationMinutes`}, `participantLabel`, `priceKz` (copiado), `startsAt`, `endsAt`, `status`, `paymentStatus`, `statusReason?`, `cancelledBy?`, `systemReason?`, `cancelledLate`, `meetingInfo?`, `paymentInstructions?` (só `CONFIRMED`/`COMPLETED` com preço > 0), `processId?`, `appointmentId?`, `conversationId?`, `canCancel`, `canSendProof`, `canReview`, `hasReview`, `createdAt`, `updatedAt` · **ProfessionalBooking** — o mesmo **sem** `memberId`, `professional`, `paymentInstructions`, `processId`, `appointmentId`, `canCancel`/`canSendProof`/`canReview`/`hasReview` e com `proof?` (nunca ids de família/membro/utilizador, BR-MKT-63) · **PaymentProof** — `id`, `bookingId`, `status` (SUBMITTED|CONFIRMED|REJECTED|DISPUTED|REJECTION_UPHELD), `scanStatus`, `contentType`, `sizeBytes`, `decisionReason?`, `disputeNote?`, `disputeDecision?`, `decidedAt?`, `disputedAt?`, `purged`, `createdAt` · **ReviewSummary** — `count`, `averageRating?` (só com ≥ 3) · **FamilyReview** — `bookingId`, `rating`, `comment?`, `commentHidden`, `reply?`, `consultedMonth`, `createdAt`, `updatedAt`, `editableUntil` · **PublicReview**/**ProfessionalReview** — `id`, `rating`, `comment?`, `commentHidden`, `reply?`, `specialty`, `method`, `consultedMonth`, `createdOn` (+ `reported` no profissional); **anónimas** · **PublicReviewPage** — `summary`, `items`, `nextCursor` · **AdminPaymentDisputeItem/Detail** — marcação (profissional pelo nome público, especialidade, método, hora, preço, estados) + metadados do comprovativo + `professionalReason?` + `familyNote?` (nunca família, membro, rótulo) · **AdminReviewReportItem/Detail** — avaliação (nota, comentário, resposta, mês, especialidade, método) + profissional + motivo/nota (nunca família, membro, marcação).
