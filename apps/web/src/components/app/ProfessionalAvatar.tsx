import { Avatar } from '@/components/ui/Avatar'
import { useProfessionalPhoto } from '@/lib/professionalPhoto'

type Size = 'sm' | 'md' | 'lg' | 'xl'

/** Avatar do profissional em sessão: foto deste dispositivo, ou as iniciais do nome por omissão. */
export function ProfessionalAvatar({ professionalId, name, size = 'md', className }: { professionalId?: string; name: string; size?: Size; className?: string }) {
  const photo = useProfessionalPhoto(professionalId)
  return <Avatar name={name} src={photo ?? undefined} size={size} className={className} />
}
