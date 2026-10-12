// Operações de ciclo de vida sobre membros (UC-MEM-10, BR-MEM-10/11, Q7), executadas pelo job
// diário de `lifecycle` pela raiz: aos 18 anos a tutela termina; sem conta, os dados ficam
// bloqueados e são apagados ao fim de 90 dias. Só os repositórios de `families` tocam nas tabelas.
export const BLOCKED_RETENTION_DAYS = 90;

/** Quem deve ser avisado a propósito de um membro (só ids de utilizadores com conta). */
export interface LifecycleTarget {
  familyId: string;
  memberId: string;
  name: string;
  /** Conta do próprio membro, se tiver. */
  userId?: string;
  guardianUserIds: string[];
  adminUserIds: string[];
}

export interface LifecycleRepository<Trx> {
  /** Menores (dependentes ativos) cujo 18.º aniversário é daqui a `inDays` dias (0 = hoje). */
  listTurningAdult(trx: Trx, today: string, inDays: number): Promise<LifecycleTarget[]>;
  /** Fim da tutela (BR-MEM-10); sem conta → BLOQUEADO com apagamento agendado a 90 dias (BR-MEM-11). */
  completeComingOfAge(trx: Trx, familyId: string, memberId: string, now: Date): Promise<{ blocked: boolean }>;
  /** Bloqueados há exatamente `days` dias (avisos aos 30/60/83). */
  listBlockedForDays(trx: Trx, today: string, days: number): Promise<LifecycleTarget[]>;
  /** Bloqueados cujo prazo de 90 dias terminou. */
  listBlockedDue(trx: Trx, now: Date): Promise<LifecycleTarget[]>;
  deleteMember(trx: Trx, familyId: string, memberId: string): Promise<void>;
}
