# Vita Family — Endpoints (Fase 13)

> Estado: **v0.1** — gerado em conjunto com `openapi.yaml` (fonte de verdade). Base: `/api/v1`. Corpo JSON salvo indicação. Autenticação: `Authorization: Bearer <accessToken>`.

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
- **DESCRIPTION:** Criar consulta.
- **REQUEST:** `AppointmentInput`
- **RESPONSE:** `201` `Appointment`
- **ERRORS:** `FORBIDDEN`, `MEMBER_BLOCKED`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** FR-APT-01; gera lembretes 24 h e 2 h se futura.

### `GET /families/{familyId}/members/{memberId}/appointments/{appointmentId}`  — getAppointment
- **AUTHORIZATION:** READ(APPOINTMENTS)
- **DESCRIPTION:** Ver consulta.
- **REQUEST:** —
- **RESPONSE:** `200` `Appointment`
- **ERRORS:** `FORBIDDEN`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** —

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
- **DESCRIPTION:** Marcar realizada, faltou, cancelada ou reagendar.
- **REQUEST:** `AppointmentStatusRequest`
- **RESPONSE:** `200` `Appointment`
- **ERRORS:** `FORBIDDEN`, `INVALID_STATE_TRANSITION`, `NOT_FOUND`, `UNAUTHENTICATED`
- **BUSINESS RULES:** ST4.

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
- **DESCRIPTION:** Registar exame.
- **REQUEST:** `ExaminationInput`
- **RESPONSE:** `201` `Examination`
- **ERRORS:** `FORBIDDEN`, `MEMBER_BLOCKED`, `NOT_FOUND`, `UNAUTHENTICATED`, `VALIDATION_ERROR`
- **BUSINESS RULES:** ST5: data passada nasce COMPLETED; futura nasce SCHEDULED com lembrete 24 h.

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
- **DESCRIPTION:** Marcar realizado, cancelado ou reagendar.
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
- **BUSINESS RULES:** D8, Q9, D11: sem interpretação nem alertas; só em exames COMPLETED.

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
- **QUERY:** `status` (string), `limit` (int), `cursor` (string)
- **REQUEST:** —
- **RESPONSE:** `200` `{ items: [AdminUser], nextCursor }`
- **ERRORS:** `FORBIDDEN`, `UNAUTHENTICATED`
- **BUSINESS RULES:** D4/R10: nunca devolve dados de saúde.

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

**Prescription** — `id`: uuid, `memberId`: uuid, `issuedOn`: date, `doctorName?`: string, `notes?`: string, `status`: ACTIVE|COMPLETED|CANCELLED, `medications`: [MedicationPlan], `documentIds`: [uuid]

**PrescriptionInput** — `issuedOn`: date, `doctorName?`: string, `notes?`: string, `medications`: [MedicationPlanInput]

**PrescriptionPatch** — `issuedOn?`: date, `doctorName?`: string, `notes?`: string

**PrescriptionStatusRequest** — `status`: ACTIVE|COMPLETED|CANCELLED

**Dose** — `id`: uuid, `planId`: uuid, `medicationName`: string, `dosage`: string, `scheduledAt`: datetime, `status`: PENDING|TAKEN|NOT_TAKEN|UNCONFIRMED, `actedAt?`: datetime, `actedByUserId?`: uuid, `note?`: string

**DoseActionRequest** — `note?`: string

**DoseCorrectionRequest** — `status`: TAKEN|NOT_TAKEN, `note?`: string

**Appointment** — `id`: uuid, `memberId`: uuid, `scheduledAt`: datetime, `status`: SCHEDULED|COMPLETED|NO_SHOW|CANCELLED, `professionalName?`: string, `clinicId?`: uuid, `clinicName?`: string, `reason?`: string, `notes?`: string

**AppointmentInput** — `scheduledAt`: datetime, `professionalName?`: string, `clinicId?`: uuid, `clinicName?`: string, `reason?`: string, `notes?`: string, `status?`: SCHEDULED|COMPLETED

**AppointmentPatch** — `scheduledAt?`: datetime, `professionalName?`: string, `clinicId?`: uuid, `clinicName?`: string, `reason?`: string, `notes?`: string

**AppointmentStatusRequest** — `status`: SCHEDULED|COMPLETED|NO_SHOW|CANCELLED

**Clinic** — `id`: uuid, `name`: string, `address?`: string, `phone?`: string, `email?`: string, `type`: PARTNER|PRIVATE, `status`: ACTIVE|ARCHIVED

**ClinicInput** — `name`: string, `address?`: string, `phone?`: string, `email?`: string

**ClinicPatch** — `name?`: string, `address?`: string, `phone?`: string, `email?`: string

**ClinicStatusRequest** — `status`: ACTIVE|ARCHIVED

**ExamResult** — `id`: uuid, `parameter`: string, `valueNumeric?`: number, `valueText?`: string, `unit?`: string, `referenceMin?`: number, `referenceMax?`: number

**ExamResultInput** — `parameter`: string, `valueNumeric?`: number, `valueText?`: string, `unit?`: string, `referenceMin?`: number, `referenceMax?`: number

**ExamResultPatch** — `parameter?`: string, `valueNumeric?`: number, `valueText?`: string, `unit?`: string, `referenceMin?`: number, `referenceMax?`: number

**ExamResultHistoryItem** — `examinationId`: uuid, `examDate`: date, `valueNumeric?`: number, `valueText?`: string, `unit?`: string, `referenceMin?`: number, `referenceMax?`: number

**Examination** — `id`: uuid, `memberId`: uuid, `name`: string, `examDate`: date, `status`: SCHEDULED|COMPLETED|CANCELLED, `clinicId?`: uuid, `clinicName?`: string, `notes?`: string, `results`: [ExamResult], `documentIds`: [uuid]

**ExaminationInput** — `name`: string, `examDate`: date, `clinicId?`: uuid, `clinicName?`: string, `notes?`: string

**ExaminationPatch** — `name?`: string, `examDate?`: date, `clinicId?`: uuid, `clinicName?`: string, `notes?`: string

**ExamStatusRequest** — `status`: SCHEDULED|COMPLETED|CANCELLED

**UploadDocumentRequest** — `file`: binary, `resourceType`: PRESCRIPTION|EXAMINATION, `resourceId`: uuid

**Document** — `id`: uuid, `resourceType`: PRESCRIPTION|EXAMINATION, `resourceId`: uuid, `originalName`: string, `mimeType`: string, `sizeBytes`: int, `scanStatus`: PENDING|CLEAN|INFECTED, `createdAt`: datetime

**Alert** — `id`: uuid, `type`: MEDICATION_DUE|APPOINTMENT_REMINDER|EXAM_REMINDER|APPOINTMENT_OUTCOME_REQUEST, `familyId`: uuid, `memberId`: uuid, `memberName`: string, `message`: string, `sourceType`: DOSE|APPOINTMENT|EXAMINATION, `sourceId`: uuid, `triggerAt`: datetime, `readAt?`: datetime

**AdherenceItem** — `planId`: uuid, `medicationName`: string, `taken`: int, `notTaken`: int, `unconfirmed`: int, `pending`: int

**PendingItem** — `type`: UNCONFIRMED_DOSE|APPOINTMENT_OUTCOME|EXAM_OUTCOME, `sourceId`: uuid, `date`: datetime

**MemberReport** — `generatedAt`: datetime, `from`: date, `to`: date, `member`: Member, `bloodType?`: string, `allergies?`: [Allergy], `conditions?`: [Condition], `prescriptions?`: [Prescription], `medicationPlans?`: [MedicationPlan], `adherence?`: [AdherenceItem], `appointments?`: [Appointment], `examinations?`: [Examination]

**FamilyReportMember** — `member`: Member, `allergies?`: [Allergy], `conditions?`: [Condition], `activeMedications?`: [MedicationPlan], `upcomingAppointments?`: [Appointment], `upcomingExaminations?`: [Examination], `pending?`: [PendingItem]

**FamilyReport** — `generatedAt`: datetime, `members`: [FamilyReportMember]

**AdminUser** — `id`: uuid, `email`: email, `status`: PENDING_VERIFICATION|ACTIVE|SUSPENDED, `createdAt`: datetime

**SuspendRequest** — `reason`: string

**HealthStatus** — `status`: string


> Total: 115 operações, 86 schemas.
