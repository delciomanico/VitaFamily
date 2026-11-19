// Reconciliação de horários (BR-MKT-25): ÚNICO sítio que cria/remove `professional_slots`. Usado por criar/alterar regra, bloqueios, ativar/
// desativar oferta, aprovação/reativação e pelo job diário. Pré-condição: o chamador tem a linha do profissional bloqueada (`FOR UPDATE`) na
// transação `trx`, o que serializa tudo por profissional; a BD (UNIQUE(rule_id, starts_at) e EXCLUDE de sobreposição) é a rede de segurança.
import { newId } from "../../../platform/ids/index.js";
import { addGeneration, emptyGeneration, generateRuleCandidates, generationWindow, planGeneration, staleRuleSlots, type GenerationCounts } from "../domain/schedule.js";
import type { ProfessionalsDeps, ScheduleRuleWithOffer } from "./ports.js";

/** Só se geram horários para `APPROVED` (authorization.md §10.2); regra e oferta têm de estar ativas. */
function isEffective(approved: boolean, rule: ScheduleRuleWithOffer): boolean {
  return approved && rule.active && rule.offerActive;
}

export async function reconcileSchedule<Trx>(
  deps: Pick<ProfessionalsDeps<Trx>, "scheduleRuleRepo" | "timeOffRepo" | "slotRepo">,
  trx: Trx,
  professionalId: string,
  approved: boolean,
  now: Date,
  filter: { offerId?: string; ruleId?: string } = {},
): Promise<GenerationCounts> {
  const rules = await deps.scheduleRuleRepo.listWithOffer(trx, professionalId, filter);
  const window = generationWindow(now);
  const timeOffs = await deps.timeOffRepo.list(trx, professionalId, { endsAfter: now });
  let total = emptyGeneration();

  for (const rule of rules) {
    const counts = emptyGeneration();
    const future = await deps.slotRepo.listFuture(trx, professionalId, now);
    // Só os LIVRES são removíveis (BR-MKT-53): um horário ocupado mantém-se e continua a contar como existente na geração.
    const own = future.filter((s) => s.ruleId === rule.id && s.startsAt.getTime() > now.getTime() && s.bookingId === null);

    if (!isEffective(approved, rule)) {
      // Inativa (regra, oferta ou profissional não APPROVED): remove os horários futuros livres que gerou (os ocupados ficam, BR-MKT-53).
      counts.removed = await deps.slotRepo.deleteByIds(trx, professionalId, own.map((s) => s.id));
      total = addGeneration(total, counts);
      continue;
    }

    const candidates = generateRuleCandidates(rule, rule.offerDurationMinutes, window, now);
    // O que a regra ainda prevê = candidatos fora de bloqueios; o resto dos futuros da regra deixou de corresponder.
    const blocked = (c: { startsAt: Date; endsAt: Date }) => timeOffs.some((t) => t.startsAt.getTime() < c.endsAt.getTime() && c.startsAt.getTime() < t.endsAt.getTime());
    const desired = candidates.filter((c) => !blocked(c));
    const stale = staleRuleSlots(own, desired);
    counts.removed = await deps.slotRepo.deleteByIds(trx, professionalId, stale.map((s) => s.id));

    const staleIds = new Set(stale.map((s) => s.id));
    const existing = future.filter((s) => !staleIds.has(s.id)).map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt, ruleId: s.ruleId }));
    const plan = planGeneration(rule.id, candidates, existing, timeOffs);
    const created = await deps.slotRepo.insertMany(
      trx,
      professionalId,
      plan.toCreate.map((c) => ({ id: newId(), offerId: rule.offerId, ruleId: rule.id, startsAt: c.startsAt, endsAt: c.endsAt, createdAt: now })),
    );
    // Se a BD recusou algum (corrida impossível sob o bloqueio da linha, mas a rede existe), conta-se como sobreposição ignorada.
    counts.created = created;
    counts.skippedOverlap = plan.skippedOverlap + (plan.toCreate.length - created);
    counts.skippedTimeOff = plan.skippedTimeOff;
    counts.unchanged = plan.unchanged;
    total = addGeneration(total, counts);
  }
  return total;
}
