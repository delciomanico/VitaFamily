import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { PublicLayout } from '@/components/layout/PublicLayout'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
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
import { GuestOnly, RequireAuth, RequireFamily, RequirePendingVerification } from './guards'
import { paths } from './paths'

/** Rota provisória: substituída pela tela real na fase indicada. */
function placeholder(path: string, title: string, phase: number, backTo?: string): RouteObject {
  return { path, element: <PlaceholderPage title={title} phase={phase} backTo={backTo} /> }
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
              { index: true, element: <PlaceholderPage title="Olá" phase={4} /> },
              placeholder('health', 'Minha saúde', 5),
              placeholder('health/profile', 'Perfil de saúde', 5, paths.health),
              placeholder('health/history', 'Histórico médico', 5, paths.health),
              placeholder('health/prescriptions', 'Receitas', 6, paths.health),
              placeholder('health/prescriptions/new', 'Adicionar receita', 6, paths.prescriptions),
              placeholder('health/prescriptions/:id', 'Receita', 6, paths.prescriptions),
              placeholder('health/medications', 'Medicamentos', 6, paths.health),
              placeholder('health/medications/:id', 'Medicamento', 6, paths.medications),
              placeholder('health/examinations', 'Exames', 7, paths.health),
              placeholder('health/examinations/new', 'Adicionar exame', 7, paths.examinations),
              placeholder('health/examinations/:id', 'Exame', 7, paths.examinations),
              placeholder('health/examinations/:id/history', 'Histórico de resultados', 7, paths.examinations),
              placeholder('appointments', 'Agenda', 8),
              placeholder('appointments/new', 'Marcar consulta', 8, paths.appointments),
              placeholder('appointments/:id', 'Consulta', 8, paths.appointments),
              placeholder('family', 'Minha família', 9),
              placeholder('family/:id', 'Membro', 9, paths.family),
              placeholder('family/:id/history', 'Histórico completo', 9, paths.family),
              placeholder('alerts', 'Alertas', 10),
              placeholder('reports/family', 'Saúde da família', 11),
              placeholder('reports/preventive', 'Relatório preventivo', 11, paths.familyReport),
              { path: 'settings', element: <SettingsPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]

export const router = createBrowserRouter(routes)
