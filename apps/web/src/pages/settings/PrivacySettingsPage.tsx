import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, FileDown, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DetailSection } from '@/components/ui/InfoList'
import { PasswordInput } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage, isAppError } from '@/lib/errors'
import { formatShortDate, formatWhen } from '@/lib/format'
import { paths } from '@/routes/paths'
import { accountService } from '@/services/account.service'
import type { DataExport } from '@/types/settings'
import { SettingsSubPage } from './SettingsPage'

/** Guarda um objeto como ficheiro JSON no dispositivo. */
function saveJson(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  link.click()
  URL.revokeObjectURL(url)
}

/** Exportar os meus dados (UC-ACC-06): pedido e descarga enquanto válido. */
function Exports() {
  const { user } = useAuth()
  const toast = useToast()
  const userId = user?.id ?? ''
  const { state, reload } = useAsync(() => accountService.listMyExports(userId), [userId])
  const [requesting, setRequesting] = useState(false)

  async function request() {
    setRequesting(true)
    try {
      await accountService.requestMyExport(userId)
      toast.show('Exportação pronta para descarregar.')
      reload()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setRequesting(false)
    }
  }

  async function download(item: DataExport) {
    try {
      saveJson(
        await accountService.downloadMyExport(userId, item.id),
        `vita-family-dados-${item.requestedAt.slice(0, 10)}.json`,
      )
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }

  const items = state.status === 'success' ? state.data : []

  return (
    <DetailSection title="Exportar os meus dados">
      <p className="text-sm text-muted">
        Uma cópia, em JSON, dos dados de que é titular: conta, saúde, medicação, consultas, exames e a lista de
        documentos. Fica disponível durante 7 dias.
      </p>
      {items.length > 0 && (
        <Card className="divide-y divide-border py-1">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 py-3">
              <FileDown className="size-5 shrink-0 text-muted" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">Pedida {formatWhen(item.requestedAt).toLowerCase()}</span>
                {item.status === 'READY' && item.expiresAt && (
                  <span className="text-sm text-muted">Disponível até {formatShortDate(item.expiresAt)}</span>
                )}
              </span>
              {item.status === 'READY' ? (
                <Button
                  variant="soft"
                  size="sm"
                  onClick={() => download(item)}
                  icon={<Download className="size-4" aria-hidden />}
                >
                  Descarregar
                </Button>
              ) : (
                <Badge>Expirada</Badge>
              )}
            </div>
          ))}
        </Card>
      )}
      <Button variant="secondary" size="lg" fullWidth loading={requesting} onClick={request}>
        Pedir exportação
      </Button>
    </DetailSection>
  )
}

/** Eliminar a conta (UC-ACC-05): confirmação com a palavra-passe; definitivo. */
function DeleteAccount() {
  const { user, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [deleting, setDeleting] = useState(false)

  function close() {
    setOpen(false)
    setPassword('')
    setError(undefined)
  }

  async function confirm() {
    setDeleting(true)
    setError(undefined)
    try {
      await accountService.deleteMe(user?.id ?? '', password)
      logout()
      navigate(paths.login, { replace: true })
      toast.show('Conta eliminada.')
    } catch (e) {
      if (isAppError(e, 'INVALID_CREDENTIALS')) setError('Palavra-passe incorreta.')
      else {
        close()
        toast.show(errorMessage(e), 'error')
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <DetailSection title="Eliminar conta">
      <p className="text-sm text-muted">
        Apaga definitivamente a sua conta, os seus dados de saúde e documentos. Se for o único tutor de um dependente ou
        o único Admin da família, tem de passar essa função a outra pessoa primeiro.
      </p>
      <Button
        variant="danger-ghost"
        size="lg"
        fullWidth
        onClick={() => setOpen(true)}
        icon={<Trash2 className="size-5" aria-hidden />}
      >
        Eliminar conta
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Eliminar conta?"
        description="Esta ação não se pode desfazer. Considere exportar os seus dados antes."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void confirm()
          }}
        >
          <PasswordInput
            label="Palavra-passe"
            autoComplete="current-password"
            value={password}
            error={error}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button type="submit" variant="danger" size="lg" fullWidth loading={deleting} disabled={!password}>
            Eliminar definitivamente
          </Button>
        </form>
      </Modal>
    </DetailSection>
  )
}

/** Privacidade: exportação e eliminação dos dados (FR-PRIV-03/05). */
export function PrivacySettingsPage() {
  return (
    <SettingsSubPage title="Privacidade">
      <Exports />
      <DeleteAccount />
    </SettingsSubPage>
  )
}
