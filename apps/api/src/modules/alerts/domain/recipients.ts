// FR-ALR-08/BR-PRV-06: destinatários de um evento — o titular (sujeito com conta) e, se o sujeito
// for dependente, os seus tutores com conta; um dependente sem conta só notifica os tutores. Sem
// I/O: recebe os dados já carregados por quem chama (`families.findMemberById`/
// `listGuardianUserIds`).

export interface MemberFacts {
  userId?: string;
  isDependent: boolean;
}

/** Devolve os `userId` únicos a notificar (UC-ALR-01: "titular; para dependente: tutores + o
 * próprio se tiver conta"). `guardianUserIds` só é relevante quando `isDependent`. */
export function resolveRecipients(member: MemberFacts, guardianUserIds: string[]): string[] {
  const recipients = new Set<string>();
  if (member.isDependent) {
    for (const guardianUserId of guardianUserIds) {
      recipients.add(guardianUserId);
    }
  }
  if (member.userId) {
    recipients.add(member.userId);
  }
  return [...recipients];
}
