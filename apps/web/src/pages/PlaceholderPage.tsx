import { Hammer } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/states'

interface PlaceholderPageProps {
  title: string
  phase: number
  backTo?: string
}

/** Página provisória: cada uma é substituída pela tela real na fase indicada. */
export function PlaceholderPage({ title, phase, backTo }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} backTo={backTo} />
      <EmptyState icon={Hammer} title="Em construção" description={`Esta tela chega na fase ${phase}.`} />
    </>
  )
}
