import { Hammer } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { EmptyState } from '@/components/ui/states'
import { paths } from '@/routes/paths'

interface PlaceholderPageProps {
  title: string
  phase: number
  backTo?: string
}

/** Página provisória: cada uma é substituída pela tela real na fase indicada. */
export function PlaceholderPage({ title, phase, backTo = paths.home }: PlaceholderPageProps) {
  return (
    <Page title={title} backTo={backTo}>
      <EmptyState icon={Hammer} title="Em construção" description={`Esta tela chega na fase ${phase}.`} />
    </Page>
  )
}
