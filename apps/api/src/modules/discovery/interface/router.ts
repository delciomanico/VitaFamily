// Controllers HTTP da descoberta (tag «Marketplace»; UC-MKT-13..16, BR-MKT-32). Só User autenticado (o `bearerAuth` do contrato já recusa
// tokens de profissional/clínica com 401), SEM `AccessPolicy` (dados públicos; `PUBLIC_DATA_ROUTES`), 60 pedidos/min por utilizador
// (BR-MKT-49). Privacidade (BR-MKT-46): nenhum parâmetro do pedido (q, city, ids…) é registado, devolvido em erros nem usado como etiqueta;
// o único registo de acesso é a métrica por rota (sem query string). Respostas `no-store`.
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { RateLimitedError, UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, requireParam } from "../../../platform/http/index.js";
import type { RateLimiter } from "../../../platform/rate-limit/index.js";
import type { DiscoveryUseCases, SearchInput } from "../application/discovery.js";
import type { SearchSort } from "../domain/filters.js";

const RATE_RULE = { max: 60, windowMs: 60_000 };

type Query = Record<string, unknown>;

function str(q: Query, key: string): string | undefined {
  const v = q[key];
  return typeof v === "string" ? v : undefined;
}

function int(q: Query, key: string): number | undefined {
  const v = q[key];
  return typeof v === "number" && Number.isInteger(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined;
}

function ids(q: Query): string[] {
  const v = q.ids;
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return typeof v === "string" ? v.split(",") : [];
}

export function createDiscoveryRouter(deps: { useCases: DiscoveryUseCases; rateLimiter: RateLimiter }): Router {
  const router = Router();
  const { useCases } = deps;

  /** User autenticado + 60 pedidos/min por utilizador. Chamado em cada handler (a ordem das rotas não importa). */
  function guard(): void {
    const actor = getActor();
    if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    const decision = deps.rateLimiter.consume(`discovery:${actor.userId}`, RATE_RULE);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterMs);
  }

  router.get(
    "/marketplace/filters",
    asyncHandler(async (_req, res) => {
      guard();
      res.set("Cache-Control", "no-store").json(await useCases.getFilters());
    }),
  );

  router.get(
    "/marketplace/ranking-rules",
    asyncHandler((_req, res) => {
      guard();
      res.set("Cache-Control", "no-store").json(useCases.getRankingRules());
      return Promise.resolve();
    }),
  );

  router.get(
    "/marketplace/professionals",
    asyncHandler(async (req, res) => {
      guard();
      const q = req.query as Query;
      const input: SearchInput = {
        ...(str(q, "q") !== undefined ? { q: str(q, "q") } : {}),
        ...(str(q, "specialtyId") !== undefined ? { specialtyId: str(q, "specialtyId") } : {}),
        ...(str(q, "category") !== undefined ? { category: str(q, "category") } : {}),
        ...(str(q, "method") !== undefined ? { method: str(q, "method") as "IN_PERSON" | "VIDEO" | "CHAT" | "PHONE" } : {}),
        ...(str(q, "city") !== undefined ? { city: str(q, "city") } : {}),
        ...(int(q, "minPriceKz") !== undefined ? { minPriceKz: int(q, "minPriceKz") } : {}),
        ...(int(q, "maxPriceKz") !== undefined ? { maxPriceKz: int(q, "maxPriceKz") } : {}),
        ...(int(q, "availableWithinDays") !== undefined ? { availableWithinDays: int(q, "availableWithinDays") } : {}),
        ...(str(q, "sort") !== undefined ? { sort: str(q, "sort") as SearchSort } : {}),
        ...(int(q, "limit") !== undefined ? { limit: int(q, "limit") } : {}),
        ...(str(q, "cursor") !== undefined ? { cursor: str(q, "cursor") } : {}),
      } as SearchInput;
      res.set("Cache-Control", "no-store").json(await useCases.searchProfessionals(input));
    }),
  );

  // Declarada ANTES de `/:professionalId` para que `compare` não seja lido como id.
  router.get(
    "/marketplace/professionals/compare",
    asyncHandler(async (req, res) => {
      guard();
      const q = req.query as Query;
      res.set("Cache-Control", "no-store").json(await useCases.compareProfessionals(ids(q), str(q, "specialtyId") ?? ""));
    }),
  );

  router.get(
    "/marketplace/professionals/:professionalId",
    asyncHandler(async (req, res) => {
      guard();
      res.set("Cache-Control", "no-store").json(await useCases.getProfessionalProfile(requireParam(req, "professionalId"), str(req.query, "specialtyId")));
    }),
  );

  return router;
}
