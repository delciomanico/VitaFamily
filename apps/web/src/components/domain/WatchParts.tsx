import { Droplets, Flame, FlaskConical, Footprints, Gauge, HeartPulse, Moon, type LucideIcon } from 'lucide-react'
import { Badge, type Tone } from '@/components/ui/Badge'
import { originLabels } from '@/lib/wearableSimulator'
import type { DataOrigin, MetricType } from '@/types/wearable'

export const metricIcons: Record<MetricType, LucideIcon> = {
  HEART_RATE: HeartPulse,
  STEPS: Footprints,
  SLEEP: Moon,
  OXYGEN_SATURATION: Droplets,
  BLOOD_PRESSURE: Gauge,
  CALORIES: Flame,
}

/** Faixa fixa das páginas do relógio: deixa claro que é uma demonstração com dados simulados. */
export function DemoBanner() {
  return (
    <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3.5 py-3 text-sm text-foreground">
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <span>
        <strong>Modo demonstração.</strong> Os dados deste ecrã são simulados: não há nenhum relógio nem Health Connect
        ligados.
      </span>
    </p>
  )
}

const originTone: Record<DataOrigin, Tone> = {
  DEVICE_DIRECT: 'success',
  THIRD_PARTY_APP: 'primary',
  DERIVED: 'warning',
  MANUAL: 'neutral',
}

/** Origem do dado: medido pelo dispositivo, app de terceiros, estimado ou manual. */
export function OriginBadge({ origin }: { origin: DataOrigin }) {
  return <Badge tone={originTone[origin]}>{originLabels[origin]}</Badge>
}

/** Aviso fixo: informação de bem-estar, nunca diagnóstico (docs/wearables/05 §8). */
export function WellnessNotice() {
  return (
    <p className="text-xs text-muted">
      Informação de bem-estar recolhida pelo relógio. Não é um diagnóstico nem substitui o aconselhamento médico.
    </p>
  )
}
