import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createMetrics } from "./index.js";

function buildApp() {
  const metrics = createMetrics();
  const app = express();
  app.use(metrics.httpMiddleware);
  app.get("/metrics", metrics.handler);
  app.get("/ping", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("createMetrics", () => {
  it("expõe /metrics no formato de exposição do Prometheus", async () => {
    const response = await request(buildApp()).get("/metrics");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/plain/);
    expect(response.text).toContain("# HELP http_request_duration_seconds");
  });

  it("regista a duração do pedido por rota/estado depois de o servir", async () => {
    const app = buildApp();
    await request(app).get("/ping");
    const response = await request(app).get("/metrics");
    expect(response.text).toContain('route="/ping"');
    expect(response.text).toContain('status="200"');
  });
});
