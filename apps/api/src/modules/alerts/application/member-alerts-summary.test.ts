// M17 (BR-RPT-15): contagens de alertas de um membro, só do próprio destinatário e no período.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Alert } from "../domain/alert.js";
import { createAlertsFixtures } from "./fixtures.js";
import { createMemberAlertsSummaryUseCase } from "./member-alerts-summary.js";

const NOW = new Date("2026-10-10T08:00:00Z");

function alert(id: string, overrides: Partial<Alert>): Alert {
  return { id, recipientUserId: "user-1", familyId: "fam-1", memberId: "m1", type: "MEDICATION_DUE", sourceType: "DOSE", sourceId: id, ruleKey: "dose.due", dedupeKey: id, triggerAt: NOW, createdAt: NOW, ...overrides };
}

describe("memberAlertsSummary", () => {
  it("conta total, não lidos e por tipo; ignora outros destinatários, membros e datas fora do período", async () => {
    const fx = createAlertsFixtures(new FixedClock(NOW));
    for (const a of [
      alert("a1", {}),
      alert("a2", { type: "EXAM_REMINDER", readAt: NOW }),
      alert("a3", { recipientUserId: "user-2" }),
      alert("a4", { memberId: "m2" }),
      alert("a5", { triggerAt: new Date("2025-01-01T08:00:00Z") }),
    ]) {
      fx.alertsRepo.byId.set(a.id, a);
    }
    const summary = await createMemberAlertsSummaryUseCase(fx.deps)("user-1", "fam-1", "m1", { from: "2026-10-01", to: "2026-10-10" });
    expect(summary).toEqual({ total: 2, unread: 1, byType: { MEDICATION_DUE: 1, EXAM_REMINDER: 1 } });
    expect(Object.keys(summary)).not.toContain("message");
  });
});
