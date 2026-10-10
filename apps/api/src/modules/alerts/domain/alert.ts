// Entidade pura `Alert` (entities.md "Alertas"; schema.md §4; state-machines.md "Alert"). Sem I/O.
import type { AlertSourceType, AlertType, RuleKey } from "./rule.js";

export interface Alert {
  id: string;
  recipientUserId: string;
  familyId: string;
  memberId: string;
  type: AlertType;
  sourceType: AlertSourceType;
  sourceId: string;
  ruleKey: RuleKey;
  dedupeKey: string;
  triggerAt: Date;
  readAt?: Date;
  createdAt: Date;
}

export type { AlertSourceType, AlertType, RuleKey } from "./rule.js";
