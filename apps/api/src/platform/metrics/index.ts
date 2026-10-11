// Métricas Prometheus (monitoring.md §2, grupo "API"): pedidos por rota/estado e latência.
// Expostas em /metrics, só na rede interna (ADR-019) — nunca através do nginx do `web` nem do
// Dokploy; scraping é feito dentro da VPS.
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Registry, collectDefaultMetrics, Histogram } from "prom-client";

export interface Metrics {
  registry: Registry;
  /** Mede duração e regista pedidos por rota/método/estado; montar antes das rotas de negócio. */
  httpMiddleware: RequestHandler;
  /** Handler de GET /metrics (texto no formato de exposição do Prometheus). */
  handler: RequestHandler;
}

/** Cria o registo e a instrumentação HTTP; uma instância por processo (api.ts chama isto uma vez). */
export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const httpRequestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "Duração dos pedidos HTTP, por método, rota e código de estado.",
    labelNames: ["method", "route", "status"] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const httpMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      // `req.route`/`baseUrl` só existem depois do router do Express casar a rota; usar o caminho
      // original seria alta cardinalidade (IDs), por isso cai em "unmatched" quando não casa (404).
      const routePath: unknown = (req.route as { path?: unknown } | undefined)?.path;
      const route = typeof routePath === "string" ? `${req.baseUrl}${routePath}` : "unmatched";
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      httpRequestDuration.observe(
        { method: req.method, route, status: String(res.statusCode) },
        durationSeconds,
      );
    });
    next();
  };

  const handler: RequestHandler = (_req, res, next) => {
    registry
      .metrics()
      .then((body) => {
        res.set("Content-Type", registry.contentType);
        res.send(body);
      })
      .catch(next);
  };

  return { registry, httpMiddleware, handler };
}
