import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { ClinicShell } from '@/components/layout/ClinicShell'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { AppointmentDetailPage } from '@/pages/appointments/AppointmentDetailPage'
import { AlertsPage } from '@/pages/alerts/AlertsPage'
import { FamilyReportPage } from '@/pages/reports/FamilyReportPage'
import { PreventiveReportPage } from '@/pages/reports/PreventiveReportPage'
import { AppointmentsPage } from '@/pages/appointments/AppointmentsPage'
import { NewAppointmentPage } from '@/pages/appointments/NewAppointmentPage'
import { ExaminationDetailPage } from '@/pages/examinations/ExaminationDetailPage'
import { ExaminationHistoryPage } from '@/pages/examinations/ExaminationHistoryPage'
import { ExaminationsPage } from '@/pages/examinations/ExaminationsPage'
import { NewExaminationPage } from '@/pages/examinations/NewExaminationPage'
import { FamilyPage } from '@/pages/family/FamilyPage'
import { MemberHistoryPage } from '@/pages/family/MemberHistoryPage'
import { MemberProfilePage } from '@/pages/family/MemberProfilePage'
import { HealthHubPage } from '@/pages/health/HealthHubPage'
import { HealthProfilePage } from '@/pages/health/HealthProfilePage'
import { MedicalHistoryPage } from '@/pages/health/MedicalHistoryPage'
import { ClinicAgendaPage } from '@/pages/clinic/ClinicAgendaPage'
import { ClinicRequestsPage } from '@/pages/clinic/ClinicRequestsPage'
import { ClinicSlotsPage } from '@/pages/clinic/ClinicSlotsPage'
import { HomePage } from '@/pages/home/HomePage'
import { MedicationDetailPage } from '@/pages/medications/MedicationDetailPage'
import { MedicationsPage } from '@/pages/medications/MedicationsPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { NewPrescriptionPage } from '@/pages/prescriptions/NewPrescriptionPage'
import { PrescriptionDetailPage } from '@/pages/prescriptions/PrescriptionDetailPage'
import { PrescriptionsPage } from '@/pages/prescriptions/PrescriptionsPage'
import { ForgotPasswordPage } from '@/pages/public/ForgotPasswordPage'
import { LoginPage } from '@/pages/public/LoginPage'
import { OnboardingPage } from '@/pages/public/OnboardingPage'
import { RegisterPage } from '@/pages/public/RegisterPage'
import { SplashPage } from '@/pages/public/SplashPage'
import { VerifyPage } from '@/pages/public/VerifyPage'
import { SettingsPage } from '@/pages/settings/SettingsPage'
import { SetupFamilyPage } from '@/pages/setup/SetupFamilyPage'
import { SetupHealthPage } from '@/pages/setup/SetupHealthPage'
import { SetupMembersPage } from '@/pages/setup/SetupMembersPage'
import { GuestOnly, RequireAuth, RequireClinic, RequireFamily, RequirePendingVerification } from './guards'
import { paths } from './paths'

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
              { path: 'health', element: <HealthHubPage /> },
              { path: 'health/profile', element: <HealthProfilePage /> },
              { path: 'health/history', element: <MedicalHistoryPage /> },
              { path: 'health/prescriptions', element: <PrescriptionsPage /> },
              { path: 'health/prescriptions/new', element: <NewPrescriptionPage /> },
              { path: 'health/prescriptions/:id', element: <PrescriptionDetailPage /> },
              { path: 'health/medications', element: <MedicationsPage /> },
              { path: 'health/medications/:id', element: <MedicationDetailPage /> },
              { path: 'health/examinations', element: <ExaminationsPage /> },
              { path: 'health/examinations/new', element: <NewExaminationPage /> },
              { path: 'health/examinations/:id', element: <ExaminationDetailPage /> },
              { path: 'health/examinations/:id/history', element: <ExaminationHistoryPage /> },
              { path: 'appointments', element: <AppointmentsPage /> },
              { path: 'appointments/new', element: <NewAppointmentPage /> },
              { path: 'appointments/:id', element: <AppointmentDetailPage /> },
              { path: 'family', element: <FamilyPage /> },
              { path: 'family/:id', element: <MemberProfilePage /> },
              { path: 'family/:id/history', element: <MemberHistoryPage /> },
              { path: 'alerts', element: <AlertsPage /> },
              { path: 'reports/family', element: <FamilyReportPage /> },
              { path: 'reports/preventive', element: <PreventiveReportPage /> },
              { path: 'settings', element: <SettingsPage /> },
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
              { index: true, element: <ClinicRequestsPage /> },
              { path: 'agenda', element: <ClinicAgendaPage /> },
              { path: 'slots', element: <ClinicSlotsPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]

export const router = createBrowserRouter(routes)
