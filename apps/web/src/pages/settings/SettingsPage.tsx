import { Hammer, LogOut } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/states'
import { useAuth } from '@/contexts/AuthContext'
import { paths } from '@/routes/paths'

/** TODO(fase 12): lista completa de configurações. Por agora só “Sair”, para testar os fluxos. */
export function SettingsPage() {
  const { logout } = useAuth()
  return (
    <Page title="Configurações" backTo={paths.home} backLabel="Início">
      <EmptyState icon={Hammer} title="Em construção" description="Esta tela chega na fase 12." />
      <Button variant="secondary" size="lg" fullWidth onClick={logout} icon={<LogOut className="size-5" aria-hidden />}>
        Sair
      </Button>
    </Page>
  )
}
