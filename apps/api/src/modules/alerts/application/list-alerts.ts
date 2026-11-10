// UC-ALR-03: listar os meus alertas, não lidos primeiro. openapi.yaml `Alert` exige `memberName`/
// `message` — detalhe visível só dentro da app (alerts.md: "o detalhe só dentro da app"; nunca em
// notificações externas, BR-ALR-08). `message` é um texto fixo por `type` (sem nome/hora, ainda
// assim mais claro do que o texto genérico das notificações externas).
import type { Alert, AlertType } from "../domain/alert.js";
import type { AlertsApiDeps, CursorPage } from "./ports.js";
import { parsePageParams } from "../../../platform/page/index.js";

export interface ListAlertsQuery {
  unread?: string;
  limit?: string;
  cursor?: string;
}

export interface AlertView extends Alert {
  memberName: string;
  message: string;
}

const MESSAGE_BY_TYPE: Record<AlertType, string> = {
  MEDICATION_DUE: "Hora de uma toma de medicação.",
  APPOINTMENT_REMINDER: "Lembrete de consulta agendada.",
  EXAM_REMINDER: "Lembrete de exame agendado.",
  APPOINTMENT_OUTCOME_REQUEST: "Confirme o desfecho de uma consulta.",
  // D19/ADR-023: texto genérico, sem nome de clínica nem resultados (BR-ALR-08).
  EXAM_CANCELLED: "Um exame foi cancelado.",
  EXAM_RESULTS_AVAILABLE: "Há resultados de exame disponíveis.",
  RECOMMENDATION_ADDED: "Recebeu uma nova recomendação de uma clínica.",
  // M14 Q (BR-ALR-09, BR-CLN-30): texto genérico, sem nome nem hora (BR-ALR-07/08).
  APPOINTMENT_CONFIRM_REQUEST: "Tem uma consulta para confirmar. Abra a app.",
  FOLLOWUP_REMINDER: "Tem um retorno sugerido por uma clínica. Abra a app.",
  // M15 U (ADR-028, BR-ALR-07/08): sem nome do exame, do membro nem da clínica.
  EXAM_ORDER_ADDED: "Recebeu um novo pedido de exame de uma clínica.",
};

export function createListAlertsUseCase<Trx>(deps: AlertsApiDeps<Trx>) {
  return async function listAlerts(recipientUserId: string, query: ListAlertsQuery): Promise<CursorPage<AlertView>> {
    const { limit, cursor } = parsePageParams(query.limit, query.cursor);
    const filter = query.unread === undefined ? {} : { unread: query.unread === "true" };

    const page = await deps.alertsRepo.listByRecipient(deps.db, recipientUserId, filter, limit, cursor);
    const memberNameCache = new Map<string, string>();
    const items: AlertView[] = [];
    for (const alert of page.items) {
      const cacheKey = `${alert.familyId}:${alert.memberId}`;
      let memberName = memberNameCache.get(cacheKey);
      if (memberName === undefined) {
        const member = await deps.families.findMemberById(deps.db, alert.familyId, alert.memberId);
        memberName = member?.name ?? "";
        memberNameCache.set(cacheKey, memberName);
      }
      items.push({ ...alert, memberName, message: MESSAGE_BY_TYPE[alert.type] });
    }
    return { items, nextCursor: page.nextCursor };
  };
}
