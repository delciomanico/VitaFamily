import type { ComponentType } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AdminShell } from '@/components/layout/AdminShell'
import { AppShell } from '@/components/layout/AppShell'
import { ClinicPortalRoot, ClinicShell } from '@/components/layout/ClinicShell'
import { InsurancePortalRoot, InsuranceShell } from '@/components/layout/InsuranceShell'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { HomePage } from '@/pages/home/HomePage'
import { ForgotPasswordPage } from '@/pages/public/ForgotPasswordPage'
import { InviteAcceptPage } from '@/pages/public/InviteAcceptPage'
import { LoginPage } from '@/pages/public/LoginPage'
import { OnboardingPage } from '@/pages/public/OnboardingPage'
import { RegisterPage } from '@/pages/public/RegisterPage'
import { SplashPage } from '@/pages/public/SplashPage'
import { VerifyPage } from '@/pages/public/VerifyPage'
import { SetupFamilyPage } from '@/pages/setup/SetupFamilyPage'
import { SetupHealthPage } from '@/pages/setup/SetupHealthPage'
import { SetupMembersPage } from '@/pages/setup/SetupMembersPage'
import { FullScreenLoader } from '@/components/ui/states'
import { RouteError } from '@/components/ui/RouteError'
import {
  ClinicGuestOnly,
  InsuranceGuestOnly,
  RequireInsuranceAccount,
  RequireInsuranceAdmin,
  GuestOnly,
  RequireAuth,
  RequireClinicAccount,
  RequireClinicAdmin,
  RequireClinicStaff,
  RequireFamily,
  RequirePendingVerification,
  RequirePlatformAdmin,
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
  {
    element: <PublicLayout />,
    children: [
      { path: paths.splash, element: <SplashPage /> },
      { path: paths.onboarding, element: <OnboardingPage /> },
      { path: paths.inviteAccept, element: <InviteAcceptPage /> },
      {
        element: <GuestOnly />,
        children: [
          { path: paths.login, element: <LoginPage /> },
          { path: paths.register, element: <RegisterPage /> },
          { path: paths.forgotPassword, element: <ForgotPasswordPage /> },
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
              },
              {
                path: 'health/prescriptions/new',
                ...page(() => import('@/pages/prescriptions/NewPrescriptionPage'), 'NewPrescriptionPage'),
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
              },
              {
                path: 'health/examinations/new',
                ...page(() => import('@/pages/examinations/NewExaminationPage'), 'NewExaminationPage'),
              },
              {
                path: 'health/examinations/schedule',
                ...page(() => import('@/pages/examinations/ScheduleExaminationPage'), 'ScheduleExaminationPage'),
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
              },
              {
                path: 'appointments/new',
                ...page(() => import('@/pages/appointments/NewAppointmentPage'), 'NewAppointmentPage'),
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
              {
                path: 'family/:id/insurance',
                ...page(() => import('@/pages/family/MemberInsurancePage'), 'MemberInsurancePage'),
              },
              {
                path: 'family/:id/insurance/receipts/:receiptId',
                ...page(() => import('@/pages/family/MemberReceiptPage'), 'MemberReceiptPage'),
              },
              { path: 'family/:id', ...page(() => import('@/pages/family/MemberProfilePage'), 'MemberProfilePage') },
              {
                path: 'family/:id/history',
                ...page(() => import('@/pages/family/MemberHistoryPage'), 'MemberHistoryPage'),
              },
              { path: 'watch', ...page(() => import('@/pages/wearables/WatchPage'), 'WatchPage') },
              {
                path: 'watch/connect',
                ...page(() => import('@/pages/wearables/ConnectWatchPage'), 'ConnectWatchPage'),
              },
              {
                path: 'watch/:metric',
                ...page(() => import('@/pages/wearables/WatchMetricPage'), 'WatchMetricPage'),
              },
              { path: 'alerts', ...page(() => import('@/pages/alerts/AlertsPage'), 'AlertsPage') },
              { path: 'reports/family', ...page(() => import('@/pages/reports/FamilyReportPage'), 'FamilyReportPage') },
              {
                path: 'reports/preventive',
                ...page(() => import('@/pages/reports/PreventiveReportPage'), 'PreventiveReportPage'),
              },
              { path: 'settings', ...page(() => import('@/pages/settings/SettingsPage'), 'SettingsPage') },
              {
                path: 'settings/account',
                ...page(() => import('@/pages/settings/AccountSettingsPage'), 'AccountSettingsPage'),
              },
              {
                path: 'settings/security',
                ...page(() => import('@/pages/settings/SecuritySettingsPage'), 'SecuritySettingsPage'),
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
              { path: 'insurers', ...page(() => import('@/pages/admin/AdminInsurersPage'), 'AdminInsurersPage') },
            ],
          },
        ],
      },
    ],
  },
  {
    /*
     * Portal da seguradora (ADR-021): árvore de rotas disjunta da app e do portal da clínica,
     * com sessão de `InsuranceAccount` (`InsurancePortalRoot` monta o seu provider) e login próprio.
     */
    path: paths.insurance,
    element: <InsurancePortalRoot />,
    children: [
      {
        element: <InsuranceGuestOnly />,
        children: [{ path: 'login', ...page(() => import('@/pages/insurance/InsuranceLoginPage'), 'InsuranceLoginPage') }],
      },
      {
        element: <RequireInsuranceAccount />,
        children: [
          {
            element: <InsuranceShell />,
            children: [
              { index: true, ...page(() => import('@/pages/insurance/InsuranceClaimsPage'), 'InsuranceClaimsPage') },
              {
                element: <RequireInsuranceAdmin />,
                children: [
                  { path: 'agents', ...page(() => import('@/pages/insurance/InsuranceAgentsPage'), 'InsuranceAgentsPage') },
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
  { path: '*', ...page(() => import('@/pages/NotFoundPage'), 'NotFoundPage') },
]

/** Cada rota de topo tem o seu ecrã de falha: um erro dentro de uma área não deixa a app em branco. */
export function withErrorElements(list: RouteObject[]): RouteObject[] {
  return list.map((route) => ({ errorElement: <RouteError />, ...route }))
}

export const router = createBrowserRouter(withErrorElements(routes))
