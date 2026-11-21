import {
  Bell,
  CalendarDays,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  Pill,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { HOME_BANNER_SRC } from '@/pages/home/HomeBanner'

/*
 * Prévias decorativas do onboarding: um telemóvel com uma versão simplificada da app.
 * Sem texto real nem dados — são só ilustração (aria-hidden).
 */

export type PreviewKind = 'health' | 'family' | 'reminders'

export function OnboardingPreview({ kind }: { kind: PreviewKind }) {
  return (
    <div aria-hidden className="flex h-full flex-col overflow-hidden rounded-t-[2rem] border-[6px] border-b-0 border-foreground bg-background">
      <div className="flex h-9 shrink-0 items-center justify-center bg-brand">
        <span className="h-3 w-16 rounded-full bg-foreground" />
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-3">
        {kind === 'health' && <HealthPreview />}
        {kind === 'family' && <FamilyPreview />}
        {kind === 'reminders' && <RemindersPreview />}
      </div>
    </div>
  )
}

const tiles: LucideIcon[] = [CalendarDays, Pill, FileText, FlaskConical, History, Users, Bell, HeartPulse]

function HealthPreview() {
  return (
    <>
      <div className="h-16 shrink-0 overflow-hidden rounded-xl bg-accent/30">
        <img src={HOME_BANNER_SRC} alt="" className="size-full object-cover" onError={(e) => e.currentTarget.remove()} />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((Icon, i) => (
          <span key={i} className="flex aspect-square items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Icon className="size-4" />
          </span>
        ))}
      </div>
      <Line wide />
    </>
  )
}

const people = ['bg-accent', 'bg-primary', 'bg-success', 'bg-warning']

function FamilyPreview() {
  return (
    <div className="flex flex-col divide-y divide-border rounded-xl bg-surface px-2.5 shadow-card">
      {people.map((color) => (
        <div key={color} className="flex items-center gap-2.5 py-2.5">
          <span className={`size-8 shrink-0 rounded-full ${color} opacity-80`} />
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="h-2 w-2/3 rounded-full bg-border-strong" />
            <span className="h-2 w-1/3 rounded-full bg-border" />
          </div>
        </div>
      ))}
    </div>
  )
}

const reminders: Array<{ icon: LucideIcon; active: boolean }> = [
  { icon: Pill, active: true },
  { icon: CalendarDays, active: true },
  { icon: FlaskConical, active: false },
  { icon: Pill, active: false },
]

function RemindersPreview() {
  return (
    <>
      <div className="flex gap-1.5">
        {['08:00', '14:00', '20:00'].map((time, i) => (
          <span
            key={time}
            className={`flex-1 rounded-full py-1.5 text-center text-[0.625rem] font-semibold ${
              i === 1 ? 'bg-primary text-white' : 'bg-surface text-muted'
            }`}
          >
            {time}
          </span>
        ))}
      </div>
      <div className="flex flex-col divide-y divide-border rounded-xl bg-surface px-2.5 shadow-card">
        {reminders.map(({ icon: Icon, active }, i) => (
          <div key={i} className="flex items-center gap-2.5 py-2.5">
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                active ? 'bg-primary-soft text-primary' : 'bg-surface-muted text-muted'
              }`}
            >
              <Icon className="size-4" />
            </span>
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="h-2 w-3/4 rounded-full bg-border-strong" />
              <span className="h-2 w-1/2 rounded-full bg-border" />
            </div>
            {active && <span className="size-2 rounded-full bg-primary" />}
          </div>
        ))}
      </div>
    </>
  )
}

function Line({ wide = false }: { wide?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-surface p-2.5 shadow-card">
      <span className={`h-2 rounded-full bg-border-strong ${wide ? 'w-3/4' : 'w-1/2'}`} />
      <span className="h-2 w-1/2 rounded-full bg-border" />
    </div>
  )
}
