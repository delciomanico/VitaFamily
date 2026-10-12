// UC-MEM-10 (BR-MEM-10/11, P4/B1/B2, Q7): jobs diários.
//  - `coming-of-age`: avisos 30 e 7 dias antes dos 18 anos; no dia, a tutela termina e o membro passa
//    a titular dos seus dados. Sem conta, os dados ficam BLOQUEADOS (acesso de ninguém), o Admin é
//    avisado e são apagados ao fim de 90 dias.
//  - `blocked-members`: avisos aos 30, 60 e 83 dias de bloqueio; aos 90 os dados e os ficheiros
//    do perfil são apagados.
// Os avisos coincidem com o dia exato (o job corre uma vez por dia); um dia perdido perde só o aviso.
import { newId } from "../../../platform/ids/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Clock } from "../../../platform/clock/index.js";

export interface LifecycleTarget {
  familyId: string;
  memberId: string;
  name: string;
  userId?: string;
  guardianUserIds: string[];
  adminUserIds: string[];
}

export interface MemberLifecycleDeps<Trx> {
  members: {
    listTurningAdult: (trx: Trx, today: string, inDays: number) => Promise<LifecycleTarget[]>;
    completeComingOfAge: (trx: Trx, familyId: string, memberId: string, now: Date) => Promise<{ blocked: boolean }>;
    listBlockedForDays: (trx: Trx, today: string, days: number) => Promise<LifecycleTarget[]>;
    listBlockedDue: (trx: Trx, now: Date) => Promise<LifecycleTarget[]>;
    deleteMember: (trx: Trx, familyId: string, memberId: string) => Promise<void>;
  };
  emailOf: (trx: Trx, userId: string) => Promise<string | null>;
  mailer: { send: (email: { to: string; subject: string; text: string }) => Promise<void> };
  purgeMemberFiles: (trx: Trx, familyId: string, memberId: string) => Promise<void>;
  audit: { record: (trx: Trx, event: AuditEvent) => Promise<void> };
  withTransaction: <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;
  clock: Clock;
  /** Falha ao enviar um aviso não pode travar o apagamento nem os restantes avisos. */
  onNotifyError: (error: unknown) => void;
}

export const COMING_OF_AGE_WARNING_DAYS = [30, 7];
export const BLOCKED_WARNING_DAYS = [30, 60, 83];

const todayOf = (now: Date) => now.toISOString().slice(0, 10);
const unique = (ids: string[]) => [...new Set(ids)];

export function createMemberLifecycleJobs<Trx>(deps: MemberLifecycleDeps<Trx>) {
  async function notify(userIds: string[], subject: string, text: string): Promise<void> {
    for (const userId of unique(userIds)) {
      try {
        const to = await deps.withTransaction((trx) => deps.emailOf(trx, userId));
        if (to) await deps.mailer.send({ to, subject, text });
      } catch (error) {
        deps.onNotifyError(error);
      }
    }
  }

  async function audit(trx: Trx, action: "MEMBER_COMING_OF_AGE" | "MEMBER_BLOCKED_DELETE", target: LifecycleTarget, now: Date): Promise<void> {
    await deps.audit.record(trx, {
      occurredAt: now,
      actorType: "SYSTEM",
      action,
      resourceType: "FamilyMember",
      resourceId: target.memberId,
      familyId: target.familyId,
      subjectMemberId: target.memberId,
      result: "SUCCESS",
      requestId: newId(),
    });
  }

  async function comingOfAge(): Promise<{ warned: number; converted: number; blocked: number }> {
    const now = deps.clock.now();
    const today = todayOf(now);
    let warned = 0;

    for (const days of COMING_OF_AGE_WARNING_DAYS) {
      const targets = await deps.withTransaction((trx) => deps.members.listTurningAdult(trx, today, days));
      for (const t of targets) {
        warned++;
        await notify(
          [...(t.userId ? [t.userId] : []), ...t.guardianUserIds],
          "Vita Family: 18 anos à vista",
          `${t.name} faz 18 anos dentro de ${String(days)} dias. Nessa data a tutela termina e passa a ser a própria pessoa a gerir os seus dados de saúde.`,
        );
      }
    }

    const due = await deps.withTransaction((trx) => deps.members.listTurningAdult(trx, today, 0));
    let blocked = 0;
    for (const t of due) {
      const result = await deps.withTransaction(async (trx) => {
        const outcome = await deps.members.completeComingOfAge(trx, t.familyId, t.memberId, now);
        await audit(trx, "MEMBER_COMING_OF_AGE", t, now);
        return outcome;
      });
      if (result.blocked) {
        blocked++;
        await notify(
          [...t.adminUserIds, ...t.guardianUserIds],
          "Vita Family: perfil bloqueado",
          `${t.name} fez 18 anos e não tem conta: os dados ficaram bloqueados e serão apagados em 90 dias. Convide a pessoa a criar conta para os recuperar.`,
        );
      } else {
        await notify(
          [...(t.userId ? [t.userId] : []), ...t.guardianUserIds],
          "Vita Family: tutela terminada",
          `${t.name} fez 18 anos: a tutela terminou e passou a titular dos seus dados de saúde.`,
        );
      }
    }
    return { warned, converted: due.length, blocked };
  }

  async function blockedMembers(): Promise<{ warned: number; deleted: number }> {
    const now = deps.clock.now();
    const today = todayOf(now);
    let warned = 0;

    for (const days of BLOCKED_WARNING_DAYS) {
      const targets = await deps.withTransaction((trx) => deps.members.listBlockedForDays(trx, today, days));
      for (const t of targets) {
        warned++;
        await notify(
          t.adminUserIds,
          "Vita Family: dados bloqueados a apagar",
          `Os dados de ${t.name} estão bloqueados e serão apagados definitivamente dentro de ${String(90 - days)} dias, se a pessoa não criar conta.`,
        );
      }
    }

    const due = await deps.withTransaction((trx) => deps.members.listBlockedDue(trx, now));
    for (const t of due) {
      await deps.withTransaction(async (trx) => {
        await deps.purgeMemberFiles(trx, t.familyId, t.memberId);
        await deps.members.deleteMember(trx, t.familyId, t.memberId);
        await audit(trx, "MEMBER_BLOCKED_DELETE", t, now);
      });
      await notify(t.adminUserIds, "Vita Family: dados apagados", `Os dados bloqueados de ${t.name} foram apagados ao fim de 90 dias.`);
    }
    return { warned, deleted: due.length };
  }

  return { comingOfAge, blockedMembers };
}
