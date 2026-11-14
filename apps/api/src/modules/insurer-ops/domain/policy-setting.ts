// Política da seguradora em dados (BR-SEG-40, ADR-033): prazos/janelas com mínimo, máximo e omissão definidos pelo Vita
// (`policy_setting_definitions`) e valor da seguradora/serviço (`insurer_policy_settings`). Sem constantes de prazos no código.
import { NotFoundError } from "../../../platform/errors/index.js";
import { fail } from "./validation.js";

export type PolicyUnit = "HOURS" | "DAYS";

export interface PolicySettingDefinition {
  key: string;
  unit: PolicyUnit;
  min: number;
  max: number;
  defaultValue: number;
  allowsServiceScope: boolean;
}

/** Linha gravada: `serviceId` nulo = valor da seguradora. */
export interface StoredPolicySetting {
  key: string;
  serviceId: string | null;
  value: number;
  serviceCode?: string;
  serviceName?: string;
}

export interface ResolvedPolicySetting {
  value: number;
  source: "SERVICE" | "INSURER" | "DEFAULT";
}

/** Resolução (BR-SEG-40): serviço > seguradora > omissão do Vita. Os consumidores (fatias 3, 4, 6) leem sempre por aqui. */
export function resolvePolicySetting(definition: PolicySettingDefinition, stored: readonly StoredPolicySetting[], serviceId?: string): ResolvedPolicySetting {
  const mine = stored.filter((s) => s.key === definition.key);
  const forService = serviceId === undefined || !definition.allowsServiceScope ? undefined : mine.find((s) => s.serviceId === serviceId);
  if (forService) return { value: forService.value, source: "SERVICE" };
  const forInsurer = mine.find((s) => s.serviceId === null);
  return forInsurer ? { value: forInsurer.value, source: "INSURER" } : { value: definition.defaultValue, source: "DEFAULT" };
}

const UNIT_LABEL: Record<PolicyUnit, string> = { HOURS: "horas", DAYS: "dias" };

/** `min ≤ valor ≤ max`, inteiro; senão `VALIDATION_ERROR` com `field=value` («entre 24 e 120 horas»). */
export function assertWithinLimits(definition: PolicySettingDefinition, value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) fail("value", "tem de ser um número inteiro");
  if (value < definition.min || value > definition.max) fail("value", `entre ${String(definition.min)} e ${String(definition.max)} ${UNIT_LABEL[definition.unit]}`);
  return value;
}

/** `serviceId` só nas chaves que admitem exceção por serviço (senão `VALIDATION_ERROR`). */
export function assertServiceScope(definition: PolicySettingDefinition, serviceId: string | undefined): void {
  if (serviceId !== undefined && !definition.allowsServiceScope) fail("serviceId", "esta regra não admite exceção por serviço");
}

/** Chave desconhecida ⇒ `NOT_FOUND`. */
export function requireDefinition(definitions: readonly PolicySettingDefinition[], key: string): PolicySettingDefinition {
  const found = definitions.find((d) => d.key === key);
  if (!found) throw new NotFoundError({ detail: "Recurso não encontrado." });
  return found;
}

export interface PolicySettingView extends PolicySettingDefinition {
  /** Efetivo ao nível da seguradora (definição própria ou omissão do Vita). */
  value: number;
  source: "DEFAULT" | "INSURER";
  serviceOverrides: { serviceId: string; serviceCode: string; serviceName: string; value: number }[];
}

/** Vista de uma chave para o portal: valor efetivo da seguradora e exceções por serviço (só se a chave as admitir). */
export function describePolicySetting(definition: PolicySettingDefinition, stored: readonly StoredPolicySetting[]): PolicySettingView {
  const { value, source } = resolvePolicySetting(definition, stored);
  const serviceOverrides = stored.flatMap((s) => (s.key === definition.key && s.serviceId !== null ? [{ serviceId: s.serviceId, serviceCode: s.serviceCode ?? "", serviceName: s.serviceName ?? "", value: s.value }] : []));
  return { ...definition, value, source: source === "INSURER" ? "INSURER" : "DEFAULT", serviceOverrides };
}
