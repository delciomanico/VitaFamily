import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { appointmentService } from '@/services/appointment.service'
import type { ConfirmationResponse } from '@/types/appointment'

interface ConfirmationButtonsProps {
  appointment: { id: string; memberId: string }
  /** Chamado quando a resposta fica registada (e, em "Não posso", depois de fechar a oferta de novo horário). */
  onDone: () => void
  size?: 'sm' | 'lg'
}

/**
 * "Vou" / "Não posso" (M14 Q, BR-CLN-26, UC-CLN-20). "Não posso" cancela a consulta e liberta o
 * horário (pede confirmação); de seguida oferece pedir outro horário, que é o fluxo de pedido
 * existente — não há remarcação nova.
 */
export function ConfirmationButtons({ appointment, onDone, size = 'sm' }: ConfirmationButtonsProps) {
  const { user, family } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [asking, setAsking] = useState(false)
  const [offer, setOffer] = useState(false)
  const [saving, setSaving] = useState<ConfirmationResponse | null>(null)

  async function respond(response: ConfirmationResponse) {
    setSaving(response)
    try {
      await appointmentService.setConfirmation(family?.id ?? '', user?.id ?? '', appointment, response)
      setAsking(false)
      if (response === 'GOING') {
        toast.show('Presença confirmada.')
        onDone()
      } else {
        toast.show('Consulta cancelada.')
        setOffer(true)
      }
    } catch (error) {
      toast.show(errorMessage(error), 'error')
      setAsking(false)
    } finally {
      setSaving(null)
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <Button size={size} loading={saving === 'GOING'} onClick={() => void respond('GOING')} className="flex-1 sm:flex-none">
          Vou
        </Button>
        <Button size={size} variant="secondary" onClick={() => setAsking(true)} className="flex-1 sm:flex-none">
          Não posso
        </Button>
      </div>

      <ConfirmDialog
        open={asking}
        title="Não pode ir à consulta?"
        description="A consulta é cancelada e o horário fica livre para outras pessoas."
        confirmLabel="Sim, cancelar"
        cancelLabel="Voltar"
        destructive
        loading={saving === 'CANNOT'}
        onConfirm={() => void respond('CANNOT')}
        onCancel={() => setAsking(false)}
      />
      <ConfirmDialog
        open={offer}
        title="Quer escolher outro horário?"
        description="Peça um novo horário à clínica. Pode também fazê-lo mais tarde."
        confirmLabel="Escolher outro horário"
        cancelLabel="Agora não"
        onConfirm={() => {
          setOffer(false)
          onDone()
          navigate(paths.appointmentNew)
        }}
        onCancel={() => {
          setOffer(false)
          onDone()
        }}
      />
    </>
  )
}
