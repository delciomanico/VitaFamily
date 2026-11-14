import { RouterProvider } from 'react-router-dom'
import { BootSplash } from '@/components/ui/BootSplash'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { useAndroidBackButton } from '@/hooks/useAndroidBackButton'
import { router } from '@/routes/router'

export function App() {
  useAndroidBackButton()
  return (
    <ErrorBoundary variant="page">
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
        <BootSplash />
      </AuthProvider>
    </ToastProvider>
    </ErrorBoundary>
  )
}
