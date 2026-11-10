// Matriz papel × rota de TODAS as rotas `/clinic-portal/*` (M14 R, BR-CLN-39, authorization.md §6.2b): é a fonte
// única da decisão papel -> rota. Os módulos donos dos dados aplicam, depois, o filtro "suas" do Médico (marcações do seu
// profissional e pacientes que tenha/tenha tido). O teste `clinic-portal-access.test.ts` compara esta matriz com o
// `openapi.yaml` e com as rotas registadas nos routers (TC-AZ-CLN-V5). O isolamento por clínica (§6.1) aplica-se sempre.
import { ForbiddenError } from "../../../platform/errors/index.js";
import type { ClinicAccountRole } from "./clinic-account.js";

/** `yes` = permitido; `no` = `FORBIDDEN`; `own` = permitido, mas só as "suas" (filtro do módulo dono do dado). */
export type PortalAccess = "yes" | "no" | "own";
export type PortalMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface PortalRouteRule {
  method: PortalMethod;
  /** Caminho Express (`:param`) sem o prefixo `/api/v1`. */
  path: string;
  admin: PortalAccess;
  manager: PortalAccess;
  doctor: PortalAccess;
}

type Row = [methods: PortalMethod[], paths: string[], admin: PortalAccess, manager: PortalAccess, doctor: PortalAccess];

const ALL: Row[] = [
  [["POST"], ["/clinic-portal/auth/login", "/clinic-portal/auth/refresh", "/clinic-portal/auth/logout"], "yes", "yes", "yes"],
  [["GET", "POST"], ["/clinic-portal/staff"], "yes", "no", "no"],
  [["DELETE"], ["/clinic-portal/staff/:clinicAccountId"], "yes", "no", "no"],
  [["GET"], ["/clinic-portal/profile"], "yes", "yes", "no"],
  [["PATCH"], ["/clinic-portal/profile"], "yes", "no", "no"],
  [["GET"], ["/clinic-portal/audit"], "yes", "no", "no"],
  [["GET", "POST"], ["/clinic-portal/receipts"], "yes", "yes", "no"],
  [["GET"], ["/clinic-portal/receipts/:receiptId"], "yes", "yes", "no"],
  [["POST"], ["/clinic-portal/receipts/:receiptId/void"], "yes", "yes", "no"],
  [["GET"], ["/clinic-portal/reports/summary"], "yes", "yes", "no"],
  [["GET", "POST"], ["/clinic-portal/slots", "/clinic-portal/professionals", "/clinic-portal/services", "/clinic-portal/schedule-rules", "/clinic-portal/time-off"], "yes", "yes", "no"],
  [["PATCH", "DELETE"], ["/clinic-portal/slots/:slotId"], "yes", "yes", "no"],
  [["PATCH"], ["/clinic-portal/professionals/:professionalId", "/clinic-portal/services/:serviceTypeId", "/clinic-portal/schedule-rules/:ruleId"], "yes", "yes", "no"],
  [["POST"], ["/clinic-portal/schedule-rules/:ruleId/regenerate"], "yes", "yes", "no"],
  [["DELETE"], ["/clinic-portal/time-off/:timeOffId"], "yes", "yes", "no"],
  [["GET"], ["/clinic-portal/requests"], "yes", "yes", "no"],
  [["PUT"], ["/clinic-portal/requests/:appointmentId"], "yes", "yes", "no"],
  [["GET"], ["/clinic-portal/agenda"], "yes", "yes", "own"],
  [["PUT"], ["/clinic-portal/agenda/:appointmentId/cancel", "/clinic-portal/agenda/:appointmentId/confirm", "/clinic-portal/agenda/:appointmentId/arrive", "/clinic-portal/agenda/:appointmentId/no-show"], "yes", "yes", "no"],
  [["PUT"], ["/clinic-portal/agenda/:appointmentId/start", "/clinic-portal/agenda/:appointmentId/complete"], "yes", "yes", "own"],
  [["PUT", "DELETE"], ["/clinic-portal/agenda/:appointmentId/follow-up"], "yes", "yes", "own"],
  [["GET"], ["/clinic-portal/follow-ups", "/clinic-portal/calendar"], "yes", "yes", "own"],
  // M15 S (BR-CLN-44): Admin e Gestor LEEM o relatório e o PDF; só o Médico (nas suas) escreve, finaliza e acrescenta adendas.
  [["GET"], ["/clinic-portal/agenda/:appointmentId/report", "/clinic-portal/agenda/:appointmentId/report/pdf"], "yes", "yes", "own"],
  [["PUT"], ["/clinic-portal/agenda/:appointmentId/report", "/clinic-portal/agenda/:appointmentId/report/finalize"], "no", "no", "own"],
  [["POST"], ["/clinic-portal/agenda/:appointmentId/report/addenda"], "no", "no", "own"],
  // M15 U/V (ADR-028, BR-CLN-51/54/55): Admin e Gestor leem e imprimem o pedido de exame e emitem a declaração de presença;
  // só o Médico (nas suas) cria e cancela pedidos.
  [["GET"], ["/clinic-portal/agenda/:appointmentId/exam-orders", "/clinic-portal/agenda/:appointmentId/exam-orders/pdf", "/clinic-portal/agenda/:appointmentId/attendance-statement/pdf"], "yes", "yes", "own"],
  [["POST"], ["/clinic-portal/agenda/:appointmentId/exam-orders"], "no", "no", "own"],
  [["PUT"], ["/clinic-portal/agenda/:appointmentId/exam-orders/:orderId/cancel"], "no", "no", "own"],
  // M15 U (BR-CLN-51): escolha do serviço de exame ao pedir — os três papéis (projeção sem preços); o catálogo completo continua Admin/Gestor.
  [["GET"], ["/clinic-portal/exam-service-types"], "yes", "yes", "yes"],
  [["GET"], ["/clinic-portal/exam-agenda"], "yes", "yes", "own"],
  [["PUT"], ["/clinic-portal/exam-agenda/:examinationId/complete"], "yes", "yes", "own"],
  // M15 T (BR-CLN-47..49): rascunho de resultados e laudo = permissões de `complete` de exame (entrada de valores, não autoria clínica).
  [["GET", "PUT", "DELETE"], ["/clinic-portal/exam-agenda/:examinationId/results-draft"], "yes", "yes", "own"],
  [["GET"], ["/clinic-portal/exam-agenda/:examinationId/report/pdf"], "yes", "yes", "own"],
  [["POST"], ["/clinic-portal/exam-agenda/:examinationId/documents"], "yes", "yes", "own"],
  [["DELETE"], ["/clinic-portal/exam-agenda/:examinationId/documents/:documentId"], "yes", "yes", "own"],
  [["PUT"], ["/clinic-portal/exam-agenda/:examinationId/cancel"], "yes", "yes", "no"],
  [["GET", "POST"], ["/clinic-portal/recommendations"], "yes", "yes", "own"],
  [["GET"], ["/clinic-portal/patients", "/clinic-portal/patients/:patientId", "/clinic-portal/patients/:patientId/record", "/clinic-portal/patients/:patientId/shared-history"], "yes", "yes", "own"],
  [["POST"], ["/clinic-portal/patients", "/clinic-portal/patients/link"], "yes", "yes", "no"],
  [["PATCH"], ["/clinic-portal/patients/:patientId"], "yes", "yes", "no"],
  [["POST"], ["/clinic-portal/patient-lookup", "/clinic-portal/walk-in-appointments"], "yes", "yes", "no"],
  [["GET"], ["/clinic-portal/search"], "yes", "yes", "no"],
];

export const CLINIC_PORTAL_ACCESS: readonly PortalRouteRule[] = ALL.flatMap(([methods, paths, admin, manager, doctor]) =>
  methods.flatMap((method) => paths.map((path) => ({ method, path, admin, manager, doctor }))),
);

const COMPILED = CLINIC_PORTAL_ACCESS.map((rule) => ({ rule, pattern: new RegExp(`^${rule.path.replace(/:[A-Za-z]+/g, "[^/]+")}/?$`) }));

function pathAfterPortalPrefix(pathname: string): string {
  const index = pathname.indexOf("/clinic-portal/");
  return index >= 0 ? pathname.slice(index) : pathname;
}

/** Regra da rota (método + caminho concreto); `undefined` = rota fora da matriz. */
export function findPortalRule(method: string, pathname: string): PortalRouteRule | undefined {
  const path = pathAfterPortalPrefix(pathname);
  const upper = method.toUpperCase();
  return COMPILED.find((c) => c.rule.method === upper && c.pattern.test(path))?.rule;
}

export function accessFor(rule: PortalRouteRule, role: ClinicAccountRole): PortalAccess {
  return role === "CLINIC_ADMIN" ? rule.admin : role === "CLINIC_MANAGER" ? rule.manager : rule.doctor;
}

/** Fecha por omissão: rota fora da matriz ou papel sem acesso => `FORBIDDEN` (papel insuficiente, não revela mais nada). */
export function assertPortalAccess(role: ClinicAccountRole, method: string, pathname: string): PortalAccess {
  const rule = findPortalRule(method, pathname);
  const access = rule ? accessFor(rule, role) : "no";
  if (access === "no") {
    throw new ForbiddenError({ detail: "Sem permissão para esta operação." });
  }
  return access;
}
