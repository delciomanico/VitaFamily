import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, CircleCheck, FileBadge, MessageCircle, Send, Sparkles, Tags, UserPen, CalendarClock, type LucideIcon } from 'lucide-react'
import { HeroBand, Sunrise } from '@/components/app/Sunrise'
import { toneTile } from '@/lib/tones'
import { cn } from '@/lib/cn'
import { BookingCard } from '@/components/app/BookingCard'
import { AccordionSection } from '@/components/app/Accordion'
import { ConfirmSheet } from '@/components/app/Sheet'
import { LockedNotice } from '@/components/professional/LockedNotice'
import { ValidationStatusBadge } from '@/components/professional/ValidationStatusBadge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ErrorState, FormError, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAsync } from '@/hooks/useAsync'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useProfessionalProfile } from '@/hooks/useProfessionalProfile'
import { errorMessage } from '@/lib/errors'
import { formatLongDate, formatWhenLuanda, luandaDayISO } from '@/lib/format'
import { requirementLabel, validationStatusHint } from '@/lib/professional'
import { greeting, greetingName, missingDocuments, missingProfile } from '@/lib/professionalApp'
import { paths } from '@/routes/paths'
import { professionalBookingService } from '@/services/professionalBooking.service'
import { professionalConversationService } from '@/services/professionalConversation.service'
import { professionalPortalService } from '@/services/professionalPortal.service'

interface NextStep {
  icon: LucideIcon
  title: string
  text: string
  /** Rota do botão; sem rota, o botão é `onClick`. */
  to?: string
  label: string
  onClick?: () => void
}

/** Início (UC-MKT-12, UC-MKT-05): saudação, o próximo passo único e o resumo do dia, por etapas. */
export function ProfessionalHomePage() {
  usePageTitle('Início')
  const toast = useToast()
  const { state, reload, profile, rights } = useProfessionalProfile()
  const approved = profile?.validationStatus === 'APPROVED'
  const bookings = useAsync(() => (approved ? professionalBookingService.list() : Promise.resolve(null)), [approved])
  const conversations = useAsync(() => professionalConversationService.list('OPEN'), [])
  const offers = useAsync(() => (approved ? professionalPortalService.listOffers(true) : Promise.resolve(null)), [approved])
  const rules = useAsync(() => (approved ? professionalPortalService.listScheduleRules({ active: true }) : Promise.resolve(null)), [approved])
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  if (state.status === 'loading') return <LoadingState rows={3} label="A preparar o seu dia…" />
  if (state.status === 'error' || !profile || !rights) return <ErrorState onRetry={reload} />

  async function submit() {
    setFormError(null)
    setSubmitting(true)
    try {
      await professionalPortalService.submit()
      toast.show('Enviado para validação.')
      setConfirming(false)
      reload()
    } catch (error) {
      setConfirming(false)
      setFormError(errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const unread = conversations.state.status === 'success' ? conversations.state.data.items.reduce((sum, row) => sum + row.unreadCount, 0) : 0
  const list = bookings.state.status === 'success' && bookings.state.data ? bookings.state.data.items : []
  const requested = list.filter((b) => b.status === 'REQUESTED')
  const proofs = list.filter((b) => b.proof?.status === 'SUBMITTED')
  const activeOffers = offers.state.status === 'success' ? offers.state.data : null
  const activeRules = rules.state.status === 'success' ? rules.state.data : null

  const missing = profile.requirements.missing
  let step: NextStep | null = null
  if (rights.submit) {
    if (missingProfile(missing)) {
      step = { icon: UserPen, title: 'Complete o seu perfil', text: 'Diga-nos o seu nome, a cidade e a sua especialidade. Leva 2 minutos.', to: paths.professionalProfileEdit, label: 'Completar o perfil' }
    } else if (missingDocuments(missing)) {
      step = { icon: FileBadge, title: 'Carregue os seus documentos', text: 'Precisamos de ver a sua identificação e a sua cédula profissional.', to: paths.professionalCredentialNew, label: 'Carregar documentos' }
    } else if (profile.requirements.canSubmit) {
      step = { icon: Send, title: 'Está tudo pronto', text: 'Envie o seu perfil para a nossa equipa o analisar.', label: 'Enviar para validação', onClick: () => setConfirming(true) }
    }
  } else if (approved) {
    if (requested.length > 0) {
      step = {
        icon: CalendarCheck,
        title: requested.length === 1 ? 'Um pedido espera pela sua resposta' : `${requested.length} pedidos esperam pela sua resposta`,
        text: 'A família fica a aguardar. Sem resposta em 48 horas, o pedido é cancelado.',
        to: paths.professionalBooking(requested[0]!.id),
        label: 'Responder agora',
      }
    } else if (proofs.length > 0) {
      step = { icon: CalendarCheck, title: 'Há um comprovativo para analisar', text: 'Confirme se recebeu o pagamento.', to: paths.professionalBooking(proofs[0]!.id), label: 'Ver o comprovativo' }
    } else if (unread > 0) {
      step = { icon: MessageCircle, title: unread === 1 ? 'Tem 1 mensagem por ler' : `Tem ${unread} mensagens por ler`, text: 'Uma resposta rápida ajuda as famílias a confiar em si.', to: paths.professionalConversations, label: 'Ver as conversas' }
    } else if (activeOffers && activeOffers.length === 0) {
      step = { icon: Tags, title: 'Crie o seu primeiro serviço', text: 'Escolha o que oferece e o preço. As famílias só podem marcar depois disto.', to: paths.professionalOfferNew, label: 'Criar um serviço' }
    } else if (activeRules && activeRules.length === 0) {
      step = { icon: CalendarClock, title: 'Defina quando atende', text: 'Escolha os dias e as horas em que as famílias o podem marcar.', to: paths.professionalScheduleNew, label: 'Definir horários' }
    }
  }

  const now = new Date()
  const today = luandaDayISO(now)
  const todayNames = list.filter((b) => luandaDayISO(b.startsAt) === today && b.status === 'CONFIRMED').length

  return (
    <div className="flex flex-col">
      <HeroBand
        sun={<Sunrise />}
        className="-mx-5 -mt-[max(1.25rem,env(safe-area-inset-top))] pt-[calc(max(1.25rem,env(safe-area-inset-top))+2rem)]"
      >
        <header className="flex flex-col gap-1 px-5 pr-24">
          <h1 className="font-display text-[1.25rem] leading-tight font-semibold text-balance">
            {greeting(now)}
            {greetingName(profile.displayName) && `, ${greetingName(profile.displayName)}`}
          </h1>
          <p className="text-base text-white/85 first-letter:uppercase">{formatLongDate(today)}</p>
        </header>
      </HeroBand>
      <div className="relative z-10 -mt-8 flex flex-col gap-6">
      {rights.readOnly && (
        <LockedNotice>Perfil em modo só de leitura: pode consultar os seus dados, mas não os pode alterar.</LockedNotice>
      )}

      {!approved && (
        <Card className="flex flex-col gap-3 rounded-2xl p-5">
          <p className="text-base font-medium text-muted">O seu perfil</p>
          <ValidationStatusBadge status={profile.validationStatus} />
          <p className="text-base">{validationStatusHint[profile.validationStatus]}</p>
          {profile.statusReason && (
            <div className="rounded-xl bg-surface-muted px-4 py-3 text-base">
              <p className="font-medium">Mensagem da equipa</p>
              <p className="mt-1 whitespace-pre-line">{profile.statusReason}</p>
            </div>
          )}
        </Card>
      )}

      <FormError message={formError} />

      {step ? (
        <section aria-labelledby="proximo-passo" className="flex flex-col gap-4 rounded-3xl bg-primary-soft p-5">
          <div className="flex items-center gap-3">
            <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl', toneTile.chat)}>
              <step.icon className="size-7" aria-hidden />
            </span>
            <h2 id="proximo-passo" className="text-lg font-semibold">
              O que falta fazer
            </h2>
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-display text-[1.25rem] leading-tight font-semibold text-foreground">{step.title}</p>
            <p className="text-base text-foreground">{step.text}</p>
          </div>
          {step.to ? (
            <ButtonLink to={step.to} size="xl" fullWidth>
              {step.label}
            </ButtonLink>
          ) : (
            <Button size="xl" fullWidth onClick={step.onClick} loading={submitting}>
              {step.label}
            </Button>
          )}
        </section>
      ) : (
        approved && (
          <section className="flex items-center gap-4 rounded-3xl bg-primary-soft p-5">
            <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl', toneTile.family)}>
              <CircleCheck className="size-7" aria-hidden />
            </span>
            <div>
              <h2 className="font-display text-xl font-bold">Está tudo em dia</h2>
              <p className="text-base text-foreground">Não há nada à espera da sua resposta.</p>
            </div>
          </section>
        )
      )}

      {rights.submit && missing.length > 0 && (
        <AccordionSection title="Ver tudo o que falta" summary={`${missing.length} ${missing.length === 1 ? 'coisa' : 'coisas'}`} icon={Sparkles}>
          <ul className="list-disc ps-5 text-base">
            {missing.map((requirement) => (
              <li key={requirement}>{requirementLabel[requirement]}</li>
            ))}
          </ul>
        </AccordionSection>
      )}

      {approved && (
        <section aria-labelledby="proximas" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="proximas" className="text-xl font-semibold">
              Próximas marcações
            </h2>
            {list.length > 0 && (
              <Link to={paths.professionalBookings} className="inline-flex min-h-12 items-center text-base font-medium text-primary">
                Ver todas
              </Link>
            )}
          </div>
          {bookings.state.status === 'loading' && <LoadingState rows={2} />}
          {bookings.state.status === 'error' && <ErrorState onRetry={bookings.reload} />}
          {bookings.state.status === 'success' &&
            (list.length === 0 ? (
              <Card className="flex flex-col items-center gap-2 rounded-2xl px-5 py-8 text-center">
                <CalendarCheck className="size-8 text-muted" aria-hidden />
                <p className="text-lg font-semibold">Ainda não tem marcações</p>
                <p className="text-base text-muted">Quando uma família marcar um dos seus horários, aparece aqui.</p>
                <ButtonLink to={paths.professionalSchedule} variant="soft" size="lg" className="mt-2">
                  Ver os meus horários
                </ButtonLink>
              </Card>
            ) : (
              <>
                {todayNames > 0 && <p className="text-base text-muted">{todayNames === 1 ? 'Hoje tem 1 consulta confirmada.' : `Hoje tem ${todayNames} consultas confirmadas.`}</p>}
                <ul className="flex flex-col gap-3">
                  {list.slice(0, 3).map((booking) => (
                    <li key={booking.id}>
                      <BookingCard booking={booking} />
                    </li>
                  ))}
                </ul>
              </>
            ))}
        </section>
      )}

      {profile.submittedAt && !approved && <p className="text-base text-muted">Enviado em {formatWhenLuanda(profile.submittedAt)}.</p>}

      <ConfirmSheet
        open={confirming}
        title="Enviar o seu perfil para validação?"
        description="Depois de enviar, a equipa analisa e não poderá alterar o nome, as especialidades nem os documentos até haver resposta."
        yesLabel="Sim, enviar"
        loading={submitting}
        onYes={() => void submit()}
        onNo={() => setConfirming(false)}
      />
      </div>
    </div>
  )
}
