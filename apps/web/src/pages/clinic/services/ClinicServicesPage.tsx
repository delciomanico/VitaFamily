import { useState } from 'react'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { ProfessionalsTab } from './ProfessionalsTab'
import { ScheduleTab } from './ScheduleTab'
import { ServicesTab } from './ServicesTab'

type TabValue = 'services' | 'professionals' | 'schedule'

const TABS: TabItem<TabValue>[] = [
  { value: 'services', label: 'Serviços' },
  { value: 'professionals', label: 'Profissionais' },
  { value: 'schedule', label: 'Horários automáticos' },
]

/**
 * Serviços da clínica (M14 a1/a2, BR-CLN-11..16): catálogo de serviços e profissionais, horários
 * gerados por regras e férias/bloqueios. Admin e Gestor da clínica têm o mesmo acesso.
 */
export function ClinicServicesPage() {
  const [tab, setTab] = useState<TabValue>('services')

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Serviços</h1>
        <p className="text-sm text-muted">O que a clínica faz, quem atende e quando — os horários criam-se a partir daqui.</p>
      </div>
      <Tabs items={TABS} value={tab} onChange={setTab} label="Secções dos serviços" scrollable />
      <div role="tabpanel">
        {tab === 'services' && <ServicesTab />}
        {tab === 'professionals' && <ProfessionalsTab />}
        {tab === 'schedule' && <ScheduleTab />}
      </div>
    </>
  )
}
