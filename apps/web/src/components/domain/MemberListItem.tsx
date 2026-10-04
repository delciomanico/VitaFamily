import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { ageOn } from '@/lib/date'
import { formatAge } from '@/lib/format'
import { relationshipLabels } from '@/lib/labels'
import type { FamilyMember } from '@/types/family'

interface MemberListItemProps {
  member: FamilyMember
  /** Ação à direita (ex.: remover). */
  action?: ReactNode
}

/** Linha compacta de membro: nome, relação e idade. */
export function MemberListItem({ member, action }: MemberListItemProps) {
  const details = [member.relationship && relationshipLabels[member.relationship], formatAge(ageOn(member.birthDate))]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex items-center gap-3 py-3">
      <Avatar name={member.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{member.name}</p>
        <p className="text-sm text-muted">{details}</p>
      </div>
      {action}
    </div>
  )
}
