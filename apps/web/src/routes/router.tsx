import type { ComponentType } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import { AdminShell } from '@/components/layout/AdminShell'
import { AppShell } from '@/components/layout/AppShell'
import { ClinicPortalRoot, ClinicShell } from '@/components/layout/ClinicShell'
import { ProfessionalPortalRoot, ProfessionalShell } from '@/components/layout/ProfessionalShell'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { PublicSiteLayout } from '@/components/layout/PublicSiteLayout'
import { HomePage } from '@/pages/home/HomePage'
import { ForgotPasswordPage } from '@/pages/public/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/public/ResetPasswordPage'
import { InviteAcceptPage } from '@/pages/public/InviteAcceptPage'
import { LoginPage } from '@/pages/public/LoginPage'
import { OnboardingPage } from '@/pages/public/OnboardingPage'
import { RegisterPage } from '@/pages/public/RegisterPage'
import { RootPage } from '@/pages/site/RootPage'
import { VerifyPage } from '@/pages/public/VerifyPage'
import { SetupFamilyPage } from '@/pages/setup/SetupFamilyPage'
import { SetupHealthPage } from '@/pages/setup/SetupHealthPage'
import { SetupMembersPage } from '@/pages/setup/SetupMembersPage'
import { FullScreenLoader } from '@/components/ui/states'
import { RouteError } from '@/components/ui/RouteError'
import {
  ClinicGuestOnly,
  GuestOnly,
  LegacyLoginRedirect,
  ProfessionalGuestOnly,
  RequireAuth,
  RequireClinicAccount,
  RequireClinicAdmin,
  RequireClinicStaff,
  RequireFamily,
  RequirePendingVerification,
  RequirePlatformAdmin,
  RequireProfessional,
} from './guards'
import { paths } from './paths'

/**
 * Página carregada só quando é aberta (code splitting): o pacote inicial fica com as páginas públicas,
 * a Home e a estrutura; o service worker guarda as restantes para uso offline.
 * Ao abrir a app diretamente numa destas páginas, mostra o carregamento até o código chegar.
 */
function page<M extends Record<N, ComponentType>, N extends keyof M & string>(load: () => Promise<M>, name: N) {
  return { lazy: async () => ({ Component: (await load())[name] }), hydrateFallbackElement: <FullScreenLoader /> }
}

export const routes: RouteObject[] = [
  { path: paths.splash, element: <RootPage /> },
  // Entrada do backoffice: ecrã próprio, sem o cabeçalho do site.
  { path: paths.backofficeLogin, ...page(() => import('@/pages/site/BackofficeLoginPage'), 'BackofficeLoginPage') },
  {
    // Site público: páginas informativas e entrada nos portais (F0.2).
    element: <PublicSiteLayout />,
    children: [
      { path: paths.requestAccessPattern, ...page(() => import('@/pages/site/RequestAccessPage'), 'RequestAccessPage') },
      { path: paths.partners, ...page(() => import('@/pages/site/PartnersPage'), 'PartnersPage') },
      { path: paths.partnersLegacy, element: <Navigate to={paths.partners} replace /> },
      { path: paths.clinics, ...page(() => import('@/pages/site/ProfessionalPages'), 'ClinicsPage') },
      { path: paths.contact, ...page(() => import('@/pages/site/ContactPage'), 'ContactPage') },
      { path: paths.faq, ...page(() => import('@/pages/site/FaqPage'), 'FaqPage') },
      { path: paths.termsPublic, ...page(() => import('@/pages/site/LegalPages'), 'TermsPublicPage') },
      { path: paths.privacyPublic, ...page(() => import('@/pages/site/LegalPages'), 'PrivacyPublicPage') },
    ],
  },
  {
    element: <PublicLayout />,
    children: [
      { path: paths.onboarding, element: <OnboardingPage /> },
      { path: paths.inviteAccept, element: <InviteAcceptPage /> },
      // Entrada única: o separador do profissional precisa da sua sessão, montada só aqui (ADR-037).
      { element: <ProfessionalPortalRoot />, children: [{ path: paths.enter, element: <LoginPage /> }] },
      { path: paths.loginLegacy, element: <LegacyLoginRedirect kind="familia" /> },
      {
        element: <GuestOnly />,
        children: [
          { path: paths.register, element: <RegisterPage /> },
          { path: paths.forgotPassword, element: <ForgotPasswordPage /> },
          { path: paths.resetPassword, element: <ResetPasswordPage /> },
        ],
      },
      {
        element: <RequirePendingVerification />,
        children: [{ path: paths.verify, element: <VerifyPage /> }],
      },
      {
        element: <RequireAuth />,
        children: [
          { path: paths.setupFamily, element: <SetupFamilyPage /> },
          {
            element: <RequireFamily />,
            children: [
              { path: paths.setupHealth, element: <SetupHealthPage /> },
              { path: paths.setupMembers, element: <SetupMembersPage /> },
            ],
          },
        ],
      },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <RequireFamily />,
        children: [
          {
            path: paths.home,
            element: <AppShell />,
            children: [
              { index: true, element: <HomePage /> },
              { path: 'health', ...page(() => import('@/pages/health/HealthHubPage'), 'HealthHubPage') },
              { path: 'marketplace', ...page(() => import('@/pages/marketplace/MarketplacePage'), 'MarketplacePage') },
              { path: 'marketplace/como-ordenamos', ...page(() => import('@/pages/marketplace/RankingRulesPage'), 'RankingRulesPage') },
              { path: 'marketplace/comparar', ...page(() => import('@/pages/marketplace/MarketplaceComparePage'), 'MarketplaceComparePage') },
              {
                path: 'marketplace/profissional/:professionalId',
                ...page(() => import('@/pages/marketplace/MarketplaceProfessionalPage'), 'MarketplaceProfessionalPage'),
              },
              { path: 'bookings', ...page(() => import('@/pages/bookings/BookingsPage'), 'BookingsPage') },
              {
                path: 'bookings/:memberId/:bookingId',
                ...page(() => import('@/pages/bookings/BookingPage'), 'BookingPage'),
                children: [{ path: 'partilhar', ...page(() => import('@/pages/shares/ShareCreatePage'), 'ShareCreatePage') }],
              },
              { path: 'shares', ...page(() => import('@/pages/shares/SharesPage'), 'SharesPage') },
              { path: 'shares/:memberId/:shareId', ...page(() => import('@/pages/shares/ShareDetailPage'), 'ShareDetailPage') },
              { path: 'messages', ...page(() => import('@/pages/messages/ConversationsPage'), 'ConversationsPage') },
              { path: 'messages/:memberId/:conversationId', ...page(() => import('@/pages/messages/ConversationPage'), 'ConversationPage') },
              {
                path: 'health/profile',
                ...page(() => import('@/pages/health/HealthProfilePage'), 'HealthProfilePage'),
              },
              {
                path: 'health/history',
                ...page(() => import('@/pages/health/MedicalHistoryPage'), 'MedicalHistoryPage'),
              },
              {
                path: 'health/prescriptions',
                ...page(() => import('@/pages/prescriptions/PrescriptionsPage'), 'PrescriptionsPage'),
                // Formulário como folha por cima da lista (a lista continua montada por baixo).
                children: [{ path: 'new', ...page(() => import('@/pages/prescriptions/NewPrescriptionPage'), 'NewPrescriptionPage') }],
              },
              {
                path: 'health/prescriptions/:id',
                ...page(() => import('@/pages/prescriptions/PrescriptionDetailPage'), 'PrescriptionDetailPage'),
              },
              {
                path: 'health/medications',
                ...page(() => import('@/pages/medications/MedicationsPage'), 'MedicationsPage'),
              },
              {
                path: 'health/medications/:id',
                ...page(() => import('@/pages/medications/MedicationDetailPage'), 'MedicationDetailPage'),
              },
              {
                path: 'health/examinations',
                ...page(() => import('@/pages/examinations/ExaminationsPage'), 'ExaminationsPage'),
                children: [
                  { path: 'new', ...page(() => import('@/pages/examinations/NewExaminationPage'), 'NewExaminationPage') },
                  { path: 'schedule', ...page(() => import('@/pages/examinations/ScheduleExaminationPage'), 'ScheduleExaminationPage') },
                ],
              },
              {
                path: 'health/examinations/:id',
                ...page(() => import('@/pages/examinations/ExaminationDetailPage'), 'ExaminationDetailPage'),
              },
              {
                path: 'health/examinations/:id/history',
                ...page(() => import('@/pages/examinations/ExaminationHistoryPage'), 'ExaminationHistoryPage'),
              },
              {
                path: 'appointments',
                ...page(() => import('@/pages/appointments/AppointmentsPage'), 'AppointmentsPage'),
                children: [{ path: 'new', ...page(() => import('@/pages/appointments/NewAppointmentPage'), 'NewAppointmentPage') }],
              },
              {
                path: 'appointments/:id',
                ...page(() => import('@/pages/appointments/AppointmentDetailPage'), 'AppointmentDetailPage'),
              },
              {
                path: 'appointments/:id/report',
                ...page(() => import('@/pages/appointments/ConsultationReportPage'), 'ConsultationReportPage'),
              },
              { path: 'family', ...page(() => import('@/pages/family/FamilyPage'), 'FamilyPage') },
              { path: 'family/:id', ...page(() => import('@/pages/family/MemberProfilePage'), 'MemberProfilePage') },
              {
                path: 'family/:id/history',
                ...page(() => import('@/pages/family/MemberHistoryPage'), 'MemberHistoryPage'),
              },
              {
                path: 'watch',
                ...page(() => import('@/pages/wearables/WatchPage'), 'WatchPage'),
                children: [{ path: 'connect', ...page(() => import('@/pages/wearables/ConnectWatchPage'), 'ConnectWatchPage') }],
              },
              {
                path: 'watch/:metric',
                ...page(() => import('@/pages/wearables/WatchMetricPage'), 'WatchMetricPage'),
              },
              { path: 'alerts', ...page(() => import('@/pages/alerts/AlertsPage'), 'AlertsPage') },
              {
                path: 'processes/:memberId/:processId',
                ...page(() => import('@/pages/processes/ProcessPage'), 'ProcessPage'),
              },
              { path: 'reports/family', ...page(() => import('@/pages/reports/FamilyReportPage'), 'FamilyReportPage') },
              {
                path: 'reports/preventive',
                ...page(() => import('@/pages/reports/PreventiveReportPage'), 'PreventiveReportPage'),
              },
              {
                path: 'settings',
                ...page(() => import('@/pages/settings/SettingsPage'), 'SettingsPage'),
                children: [{ path: 'security', ...page(() => import('@/pages/settings/SecuritySettingsPage'), 'SecuritySettingsPage') }],
              },
              {
                path: 'settings/account',
                ...page(() => import('@/pages/settings/AccountSettingsPage'), 'AccountSettingsPage'),
              },
              {
                path: 'settings/family',
                ...page(() => import('@/pages/settings/FamilySettingsPage'), 'FamilySettingsPage'),
              },
              {
                path: 'settings/sharing',
                ...page(() => import('@/pages/settings/SharingSettingsPage'), 'SharingSettingsPage'),
              },
              {
                path: 'settings/notifications',
                ...page(() => import('@/pages/settings/NotificationSettingsPage'), 'NotificationSettingsPage'),
              },
              {
                path: 'settings/privacy',
                ...page(() => import('@/pages/settings/PrivacySettingsPage'), 'PrivacySettingsPage'),
              },
              { path: 'settings/help', ...page(() => import('@/pages/settings/InfoSettingsPages'), 'HelpPage') },
              { path: 'settings/terms', ...page(() => import('@/pages/settings/InfoSettingsPages'), 'TermsPage') },
              {
                path: 'settings/privacy-policy',
                ...page(() => import('@/pages/settings/InfoSettingsPages'), 'PrivacyPolicyPage'),
              },
            ],
          },
        ],
      },
      {
        /*
         * Área do Platform Admin (`/admin`): mesma conta/sessão de `User` que a app de família
         * (login único, `platformRole` no token), mas nunca exige família — a conta é criada
         * pela CLI `create-platform-admin`, sem passar pelo registo normal.
         */
        path: paths.admin,
        element: <RequirePlatformAdmin />,
        children: [
          {
            element: <AdminShell />,
            children: [
              { index: true, ...page(() => import('@/pages/admin/AdminUsersPage'), 'AdminUsersPage') },
              { path: 'clinics', ...page(() => import('@/pages/admin/AdminClinicsPage'), 'AdminClinicsPage') },
              {
                path: 'professionals',
                ...page(() => import('@/pages/admin/AdminProfessionalsPage'), 'AdminProfessionalsPage'),
              },
              {
                path: 'professionals/:professionalId',
                ...page(() => import('@/pages/admin/AdminProfessionalDetailPage'), 'AdminProfessionalDetailPage'),
              },
              {
                path: 'specialties',
                ...page(() => import('@/pages/admin/AdminSpecialtiesPage'), 'AdminSpecialtiesPage'),
              },
              { path: 'payment-disputes', ...page(() => import('@/pages/admin/AdminPaymentDisputesPage'), 'AdminPaymentDisputesPage') },
              { path: 'payment-disputes/:proofId', ...page(() => import('@/pages/admin/AdminPaymentDisputeDetailPage'), 'AdminPaymentDisputeDetailPage') },
              { path: 'review-reports', ...page(() => import('@/pages/admin/AdminReviewReportsPage'), 'AdminReviewReportsPage') },
              { path: 'review-reports/:reportId', ...page(() => import('@/pages/admin/AdminReviewReportDetailPage'), 'AdminReviewReportDetailPage') },
              { path: 'message-reports', ...page(() => import('@/pages/admin/AdminMessageReportsPage'), 'AdminMessageReportsPage') },
              {
                path: 'message-reports/:reportId',
                ...page(() => import('@/pages/admin/AdminMessageReportDetailPage'), 'AdminMessageReportDetailPage'),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    /*
     * Portal da clínica parceira (D17/D18, ADR-020): árvore de rotas **disjunta** da app de
     * família — sessão de `ClinicAccount` (`ClinicPortalRoot` monta o seu provider), login
     * próprio em `/clinic/login` e nenhum `RequireAuth`/`RequireFamily` de `User` pelo caminho.
     */
    path: paths.clinic,
    element: <ClinicPortalRoot />,
    children: [
      {
        element: <ClinicGuestOnly />,
        children: [{ path: 'login', ...page(() => import('@/pages/clinic/ClinicLoginPage'), 'ClinicLoginPage') }],
      },
      {
        element: <RequireClinicAccount />,
        children: [
          {
            element: <ClinicShell />,
            children: [
              { index: true, ...page(() => import('@/pages/clinic/ClinicTodayPage'), 'ClinicTodayPage') },
              { path: 'agenda', ...page(() => import('@/pages/clinic/ClinicAgendaPage'), 'ClinicAgendaPage') },
              { path: 'exams', ...page(() => import('@/pages/clinic/ClinicExamsPage'), 'ClinicExamsPage') },
              {
                path: 'exams/:examinationId/results',
                ...page(() => import('@/pages/clinic/exams/ExamResultsPage'), 'ExamResultsPage'),
              },
              {
                path: 'consultations/:bookingId/report',
                ...page(() => import('@/pages/clinic/reports/ConsultationReportPage'), 'ConsultationReportPage'),
              },
              {
                path: 'patients',
                ...page(() => import('@/pages/clinic/patients/ClinicPatientsPage'), 'ClinicPatientsPage'),
              },
              {
                path: 'patients/:id',
                ...page(() => import('@/pages/clinic/patients/ClinicPatientPage'), 'ClinicPatientPage'),
              },
              {
                // Admin e Gestor (BR-CLN-39): o Médico não vê pedidos, horários, serviços, financeiro nem definições.
                element: <RequireClinicStaff />,
                children: [
                  { path: 'requests', ...page(() => import('@/pages/clinic/ClinicRequestsPage'), 'ClinicRequestsPage') },
                  { path: 'reports', ...page(() => import('@/pages/clinic/ClinicReportsPage'), 'ClinicReportsPage') },
                  { path: 'slots', ...page(() => import('@/pages/clinic/ClinicSlotsPage'), 'ClinicSlotsPage') },
                  {
                    path: 'services',
                    ...page(() => import('@/pages/clinic/services/ClinicServicesPage'), 'ClinicServicesPage'),
                  },
                  { path: 'finance', ...page(() => import('@/pages/clinic/ClinicFinancePage'), 'ClinicFinancePage') },
                  {
                    path: 'finance/:receiptId',
                    ...page(() => import('@/pages/clinic/ClinicReceiptPage'), 'ClinicReceiptPage'),
                  },
                  { path: 'settings', ...page(() => import('@/pages/clinic/ClinicSettingsPage'), 'ClinicSettingsPage') },
                ],
              },
              {
                element: <RequireClinicAdmin />,
                children: [
                  { path: 'staff', ...page(() => import('@/pages/clinic/ClinicStaffPage'), 'ClinicStaffPage') },
                  {
                    path: 'settings/audit',
                    ...page(() => import('@/pages/clinic/ClinicAuditPage'), 'ClinicAuditPage'),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    /*
     * Portal do profissional (MK1, ADR-037): árvore **disjunta** da família e da clínica — sessão de
     * `ProfessionalAccount` (`ProfessionalPortalRoot` monta o seu provider) e login próprio.
     */
    path: paths.professional,
    element: <ProfessionalPortalRoot />,
    children: [
      { path: 'entrar', element: <LegacyLoginRedirect kind="profissional" /> },
      {
        element: <ProfessionalGuestOnly />,
        children: [
          { path: 'registo', ...page(() => import('@/pages/professional/ProfessionalRegisterPage'), 'ProfessionalRegisterPage') },
          { path: 'verificar', ...page(() => import('@/pages/professional/ProfessionalVerifyPage'), 'ProfessionalVerifyPage') },
          { path: 'recuperar', ...page(() => import('@/pages/professional/ProfessionalForgotPage'), 'ProfessionalForgotPage') },
          { path: 'repor', ...page(() => import('@/pages/professional/ProfessionalResetPage'), 'ProfessionalResetPage') },
        ],
      },
      {
        element: <RequireProfessional />,
        children: [
          {
            element: <ProfessionalShell />,
            children: [
              { index: true, ...page(() => import('@/pages/professional/ProfessionalHomePage'), 'ProfessionalHomePage') },
              { path: 'perfil', ...page(() => import('@/pages/professional/ProfessionalProfileHubPage'), 'ProfessionalProfileHubPage') },
              { path: 'perfil/editar', handle: { hideNav: true }, ...page(() => import('@/pages/professional/ProfessionalProfilePage'), 'ProfessionalProfilePage') },
              {
                path: 'credenciais',
                ...page(() => import('@/pages/professional/ProfessionalCredentialsPage'), 'ProfessionalCredentialsPage'),
              },
              {
                path: 'credenciais/novo',
                handle: { hideNav: true },
                ...page(() => import('@/pages/professional/ProfessionalCredentialNewPage'), 'ProfessionalCredentialNewPage'),
              },
              { path: 'servicos', ...page(() => import('@/pages/professional/ProfessionalOffersPage'), 'ProfessionalOffersPage') },
              { path: 'servicos/novo', handle: { hideNav: true }, ...page(() => import('@/pages/professional/ProfessionalOfferNewPage'), 'ProfessionalOfferNewPage') },
              { path: 'horarios', ...page(() => import('@/pages/professional/ProfessionalSchedulePage'), 'ProfessionalSchedulePage') },
              { path: 'horarios/novo', handle: { hideNav: true }, ...page(() => import('@/pages/professional/ProfessionalScheduleRulePage'), 'ProfessionalScheduleRulePage') },
              { path: 'horarios/:ruleId/editar', handle: { hideNav: true }, ...page(() => import('@/pages/professional/ProfessionalScheduleRulePage'), 'ProfessionalScheduleRulePage') },
              { path: 'horarios/pausa', handle: { hideNav: true }, ...page(() => import('@/pages/professional/ProfessionalTimeOffNewPage'), 'ProfessionalTimeOffNewPage') },
              { path: 'marcacoes', ...page(() => import('@/pages/professional/ProfessionalBookingsPage'), 'ProfessionalBookingsPage') },
              { path: 'marcacoes/:bookingId', ...page(() => import('@/pages/professional/ProfessionalBookingPage'), 'ProfessionalBookingPage') },
              { path: 'marcacoes/:bookingId/receita', handle: { hideNav: true }, ...page(() => import('@/pages/professional/ProfessionalPrescriptionPage'), 'ProfessionalPrescriptionPage') },
              { path: 'partilhas', ...page(() => import('@/pages/professional/ProfessionalSharesPage'), 'ProfessionalSharesPage') },
              { path: 'partilhas/:shareId', ...page(() => import('@/pages/professional/ProfessionalSharePage'), 'ProfessionalSharePage') },
              { path: 'avaliacoes', ...page(() => import('@/pages/professional/ProfessionalReviewsPage'), 'ProfessionalReviewsPage') },
              { path: 'conversas', ...page(() => import('@/pages/professional/ProfessionalConversationsPage'), 'ProfessionalConversationsPage') },
              {
                path: 'conversas/:conversationId',
                // Conversa em ecrã inteiro: sem barra inferior (a caixa de escrita ocupa o fundo).
                handle: { hideNav: true, bare: true },
                ...page(() => import('@/pages/professional/ProfessionalConversationPage'), 'ProfessionalConversationPage'),
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', ...page(() => import('@/pages/NotFoundPage'), 'NotFoundPage') },
]

/** Cada rota de topo tem o seu ecrã de falha: um erro dentro de uma área não deixa a app em branco. */
export function withErrorElements(list: RouteObject[]): RouteObject[] {
  return list.map((route) => ({ errorElement: <RouteError />, ...route }))
}

export const router = createBrowserRouter(withErrorElements(routes))
