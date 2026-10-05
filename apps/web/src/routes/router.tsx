import type { ComponentType } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ClinicShell } from '@/components/layout/ClinicShell'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { HomePage } from '@/pages/home/HomePage'
import { ForgotPasswordPage } from '@/pages/public/ForgotPasswordPage'
import { LoginPage } from '@/pages/public/LoginPage'
import { OnboardingPage } from '@/pages/public/OnboardingPage'
import { RegisterPage } from '@/pages/public/RegisterPage'
import { SplashPage } from '@/pages/public/SplashPage'
import { VerifyPage } from '@/pages/public/VerifyPage'
import { SetupFamilyPage } from '@/pages/setup/SetupFamilyPage'
import { SetupHealthPage } from '@/pages/setup/SetupHealthPage'
import { SetupMembersPage } from '@/pages/setup/SetupMembersPage'
import { FullScreenLoader } from '@/components/ui/states'
import { GuestOnly, RequireAuth, RequireClinic, RequireFamily, RequirePendingVerification } from './guards'
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
              { path: 'family', ...page(() => import('@/pages/family/FamilyPage'), 'FamilyPage') },
              { path: 'family/:id', ...page(() => import('@/pages/family/MemberProfilePage'), 'MemberProfilePage') },
              {
                path: 'family/:id/history',
                ...page(() => import('@/pages/family/MemberHistoryPage'), 'MemberHistoryPage'),
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
    ],
  },
  {
    // Portal da clínica parceira (D17).
    element: <RequireAuth />,
    children: [
      {
        element: <RequireClinic />,
        children: [
          {
            path: paths.clinic,
            element: <ClinicShell />,
            children: [
              { index: true, ...page(() => import('@/pages/clinic/ClinicRequestsPage'), 'ClinicRequestsPage') },
              { path: 'agenda', ...page(() => import('@/pages/clinic/ClinicAgendaPage'), 'ClinicAgendaPage') },
              { path: 'slots', ...page(() => import('@/pages/clinic/ClinicSlotsPage'), 'ClinicSlotsPage') },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', ...page(() => import('@/pages/NotFoundPage'), 'NotFoundPage') },
]

export const router = createBrowserRouter(routes)
