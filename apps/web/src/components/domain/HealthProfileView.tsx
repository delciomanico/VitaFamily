import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { DetailSection, InfoList, InfoRow } from '@/components/ui/InfoList'
import { ageOn } from '@/lib/date'
import { formatAge, formatLongDate } from '@/lib/format'
import { bloodTypeLabel, sexLabels } from '@/lib/labels'
import type { HealthProfile } from '@/types/health'

const NOT_SET = 'Não indicado'

function TagList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item} className="rounded-full bg-surface-muted px-3 py-1 text-sm">
          {item}
        </li>
      ))}
    </ul>
  )
}

/**
 * Perfil de saúde só de leitura: identificação, dados básicos, alergias e condições.
 * Usado em “Minha saúde” e no perfil de um membro da família.
 */
export function HealthProfileView({ profile }: { profile: HealthProfile }) {
  const { member, allergies, conditions } = profile

  return (
    <div className="flex flex-col gap-6">
      {/* TBD: o domínio não tem fotografia de perfil; mostram-se as iniciais. */}
      <div className="flex items-center gap-4">
        <Avatar name={member.name} size="xl" />
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold">{member.name}</p>
          <p className="text-muted">{formatAge(ageOn(member.birthDate))}</p>
        </div>
      </div>

      <DetailSection title="Informações básicas">
        <InfoList>
          <InfoRow label="Data de nascimento" value={formatLongDate(member.birthDate)} />
          <InfoRow label="Sexo" value={member.sex ? sexLabels[member.sex] : NOT_SET} />
          <InfoRow label="Tipo sanguíneo" value={member.bloodType ? bloodTypeLabel(member.bloodType) : NOT_SET} />
        </InfoList>
      </DetailSection>

      <DetailSection title="Alergias">
        <Card>
          <TagList items={allergies.map((a) => a.name)} empty="Nenhuma alergia registada." />
        </Card>
      </DetailSection>

      <DetailSection title="Condições">
        <Card>
          <TagList items={conditions.map((c) => c.name)} empty="Nenhuma condição registada." />
        </Card>
      </DetailSection>
    </div>
  )
}
