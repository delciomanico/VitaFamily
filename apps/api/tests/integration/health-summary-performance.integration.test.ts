/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/restrict-plus-operands, @typescript-eslint/restrict-template-expressions -- corpos JSON de respostas HTTP e protótipo do cliente `pg` lidos de forma dinâmica nos testes */
// Desempenho do Resumo de saúde (M17) com um membro de volume realista em PostgreSQL real: 5 anos, 2000 tomas, 200 resultados de exame (40 exames), 60
// consultas, 30 receitas, 500 alertas. Mede tempo e NÚMERO DE CONSULTAS por pedido (deteção de N+1 por contagem das instruções enviadas ao PostgreSQL) e
// faz EXPLAIN das instruções reais com a tabela povoada. Os números medidos escrevem-se em `console.info` (linhas «[perf] …») para o relatório.
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, START, startSummaryHarness, type SummaryHarness, type SummaryUser } from "../support/health-summary-harness.js";
import { installQueryRecorder, type RecordedQuery } from "../support/query-recorder.js";

let s: SummaryHarness;
const recorder = installQueryRecorder();
let tick = 0;
beforeAll(async () => {
  s = await startSummaryHarness();
}, 300_000);
afterAll(async () => {
  await s.stop();
});
beforeEach(() => {
  s.h.clock.set(new Date(START.getTime() + ++tick * 120_000));
});

const FROM = "2021-11-16";
const TO = "2026-11-16";
const bearer = (u: SummaryUser) => ({ Authorization: `Bearer ${u.token}` });
const member = (u: SummaryUser, fam: string, m: string, query = `?from=${FROM}&to=${TO}`) => request(s.h.app).get(`${API}/families/${fam}/members/${m}/health-summary${query}`).set(bearer(u));
const family = (u: SummaryUser, fam: string, query = `?from=${FROM}&to=${TO}`) => request(s.h.app).get(`${API}/families/${fam}/health-summary${query}`).set(bearer(u));
const info = (line: string) => { console.info(`[perf] ${line}`); };

interface Dataset {
  fam: string;
  owner: SummaryUser;
  reader: SummaryUser;
  mLarge: string;
  mSmall: string;
  mReader: string;
}
let d: Dataset;

/** Povoa um membro com o volume pedido, tudo por SQL (como o gravariam os repositórios, `created_at` em ms). */
async function seedLarge(fam: string, m: string, recipient: string): Promise<void> {
  const pool = s.h.pool;
  const ms = "date_trunc('milliseconds', now())";
  // 2000 tomas em 5 anos: um plano diário (1825) + um plano de 10 em 10 dias (175).
  const daily = await s.plan({ familyId: fam, memberId: m, name: "Diário", startAt: new Date("2021-11-01T00:00:00Z") });
  await pool.query(
    `INSERT INTO dose_occurrences (family_id, member_id, plan_id, scheduled_at, status, acted_at, created_at)
     SELECT $1, $2, $3, ts, st::dose_status, CASE WHEN st IN ('TAKEN','NOT_TAKEN') THEN ts END, ${ms}
     FROM (SELECT timestamptz '2021-11-17 07:00:00+00' + g * interval '1 day' AS ts,
                  CASE WHEN g % 20 < 14 THEN 'TAKEN' WHEN g % 20 < 17 THEN 'NOT_TAKEN' ELSE 'UNCONFIRMED' END AS st
           FROM generate_series(0, 1824) g) x`,
    [fam, m, daily],
  );
  const sparse = await s.plan({ familyId: fam, memberId: m, name: "Esporádico", startAt: new Date("2021-11-01T00:00:00Z") });
  await pool.query(
    `INSERT INTO dose_occurrences (family_id, member_id, plan_id, scheduled_at, status, acted_at, created_at)
     SELECT $1, $2, $3, ts, 'TAKEN', ts, ${ms} FROM (SELECT timestamptz '2021-11-17 12:00:00+00' + g * interval '10 days' AS ts FROM generate_series(0, 174) g) x`,
    [fam, m, sparse],
  );
  // 40 exames x 5 resultados = 200 resultados (5 parâmetros, 40 pontos cada).
  await pool.query(
    `INSERT INTO examinations (id, family_id, member_id, name, exam_date, status, created_at)
     SELECT gen_random_uuid(), $1, $2, 'Análises ' || g, date '2021-12-01' + g * 45, 'COMPLETED', ${ms} FROM generate_series(0, 39) g`,
    [fam, m],
  );
  await pool.query(
    `INSERT INTO exam_results (examination_id, parameter, value_numeric, unit, reference_min, reference_max, created_at)
     SELECT e.id, p.name, 50 + ((row_number() OVER (PARTITION BY p.name ORDER BY e.exam_date)) * 7) % 41, p.unit, 40, 90, ${ms}
     FROM examinations e CROSS JOIN (VALUES ('Glicose','mg/dL'),('Colesterol','mg/dL'),('Hemoglobina','g/dL'),('Creatinina','mg/dL'),('Ureia','mg/dL')) AS p(name, unit)
     WHERE e.member_id = $1`,
    [m],
  );
  // 60 consultas, 30 receitas (cada uma com um plano) e 500 alertas.
  await pool.query(
    `INSERT INTO appointments (id, family_id, member_id, scheduled_at, status, created_at)
     SELECT gen_random_uuid(), $1, $2, timestamptz '2021-12-10 09:00:00+00' + g * interval '29 days',
            CASE WHEN g % 6 = 0 THEN 'CANCELLED' WHEN g % 6 = 1 THEN 'NO_SHOW' ELSE 'COMPLETED' END::appointment_status, ${ms} FROM generate_series(0, 59) g`,
    [fam, m],
  );
  for (let i = 0; i < 30; i++) {
    const rx = await s.prescription({ familyId: fam, memberId: m, issuedOn: `${String(2021 + Math.floor(i / 7))}-${String((i % 7) + 3).padStart(2, "0")}-15`, status: i % 3 === 0 ? "ACTIVE" : "COMPLETED" });
    await s.plan({ familyId: fam, memberId: m, name: `Rx ${String(i)}`, prescriptionId: rx, startAt: new Date("2021-11-01T00:00:00Z"), endAt: new Date("2027-01-01T00:00:00Z") });
  }
  await pool.query(
    `INSERT INTO alerts (recipient_user_id, family_id, member_id, type, source_type, source_id, rule_key, dedupe_key, trigger_at, read_at)
     SELECT $1, $2, $3, 'MEDICATION_DUE', 'DOSE', gen_random_uuid(), 'perf', 'perf-' || g, timestamptz '2021-11-20' + g * interval '84 hours', CASE WHEN g % 3 = 0 THEN now() END FROM generate_series(0, 499) g`,
    [recipient, fam, m],
  );
}

beforeAll(async () => {
  s.h.clock.set(START);
  const owner = await s.user("perf-owner");
  const reader = await s.user("perf-reader");
  const fam = await s.family();
  const mLarge = await s.member(fam, { userId: owner.id, role: "FAMILY_ADMIN", name: "Volume", bloodType: "A_POS" });
  const mReader = await s.member(fam, { userId: reader.id, role: "FAMILY_MEMBER", name: "Leitor" });
  const mSmall = await s.member(fam, { dependent: true, guardians: [mLarge], name: "Pequeno", bloodType: "A_POS" });
  for (const category of ["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"]) await s.grant(fam, mLarge, mReader, category);
  await seedLarge(fam, mLarge, owner.id);
  await s.h.pool.query(
    `INSERT INTO alerts (recipient_user_id, family_id, member_id, type, source_type, source_id, rule_key, dedupe_key, trigger_at)
     SELECT $1, $2, $3, 'EXAM_REMINDER', 'EXAMINATION', gen_random_uuid(), 'perf', 'perf-r-' || g, timestamptz '2021-11-20' + g * interval '84 hours' FROM generate_series(0, 499) g`,
    [reader.id, fam, mLarge],
  );
  // Membro «pequeno» do mesmo titular: 1 toma, 1 exame, 1 consulta, 1 receita (linha de base de consultas SQL).
  const plan = await s.plan({ familyId: fam, memberId: mSmall, name: "Único", startAt: new Date("2026-01-01T00:00:00Z") });
  await s.doses(plan, fam, mSmall, [{ at: "2026-10-10T07:00:00Z", status: "TAKEN" }]);
  await s.exam({ familyId: fam, memberId: mSmall, examDate: "2026-10-15", results: [{ parameter: "Glicose", value: 90, unit: "mg/dL" }] });
  await s.appointment({ familyId: fam, memberId: mSmall, scheduledAt: "2026-10-20T09:00:00Z", status: "COMPLETED" });
  await s.prescription({ familyId: fam, memberId: mSmall, issuedOn: "2026-10-02" });
  await s.h.pool.query("ANALYZE");
  d = { fam, owner, reader, mLarge, mSmall, mReader };
}, 300_000);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function measure(label: string, run: () => request.Test, runs = 5): Promise<{ ms: number; queries: number; body: any; statements: RecordedQuery[] }> {
  const warm = await run(); // 1.ª execução (planos/ligações aquecidos) fora da medição
  expect(warm.status, JSON.stringify(warm.body)).toBe(200);
  const times: number[] = [];
  let queries = 0;
  let body: any;
  let statements: RecordedQuery[] = [];
  for (let i = 0; i < runs; i++) {
    s.h.clock.set(new Date(s.h.clock.now().getTime() + 61_000)); // renova a janela do limitador
    recorder.reset();
    const t0 = performance.now();
    const res = await run();
    times.push(performance.now() - t0);
    expect(res.status).toBe(200);
    body = res.body;
    statements = recorder.dataStatements();
    queries = statements.length;
  }
  const ms = median(times);
  info(`${label}: mediana ${ms.toFixed(0)} ms (min ${Math.min(...times).toFixed(0)}, max ${Math.max(...times).toFixed(0)}), ${String(queries)} instruções SQL (sem BEGIN/COMMIT)`);
  return { ms, queries, body, statements };
}

describe("Desempenho do Resumo de saúde com volume realista (5 anos, 2000 tomas, 200 resultados)", () => {
  it("o volume gerado é o pretendido", async () => {
    const count = async (sql: string) => Number((await s.h.pool.query<{ n: string }>(sql, [d.mLarge])).rows[0]?.n);
    expect(await count("SELECT count(*) n FROM dose_occurrences WHERE member_id = $1")).toBe(2000);
    expect(await count("SELECT count(*) n FROM exam_results r JOIN examinations e ON e.id = r.examination_id WHERE e.member_id = $1")).toBe(200);
  });

  it("titular (SELF), 5 anos: 200 OK em tempo razoável; resposta agregada e pequena", async () => {
    const r = await measure("SELF 5 anos (2000 tomas, 200 resultados)", () => member(d.owner, d.fam, d.mLarge));
    expect(r.ms).toBeLessThan(4000);
    const bytes = JSON.stringify(r.body).length;
    info(`SELF 5 anos: corpo de ${String(bytes)} bytes, ${String(r.body.exams.series.length)} séries de exames, ${String(r.body.medication.series.length)} pontos de adesão (${r.body.medication.granularity})`);
    expect(bytes).toBeLessThan(200_000);
    // Dados agregados corretos mesmo com paginação interna das tomas (2000 tomas = 1825 + 175, sem repetições nem perdas).
    expect(r.body.medication.overall.taken + r.body.medication.overall.notTaken + r.body.medication.overall.unconfirmed).toBe(2000);
    const series = r.body.medication.series as any[];
    expect(series.reduce((n, b) => n + b.taken + b.notTaken + b.unconfirmed, 0)).toBe(2000);
  });

  it("outro titular com partilha total (OTHER): inclui a auditoria; tempo e consultas", async () => {
    const r = await measure("OTHER 5 anos (2000 tomas, 200 resultados, com auditoria)", () => member(d.reader, d.fam, d.mLarge));
    expect(r.ms).toBeLessThan(5000);
    const audits = r.statements.filter((q) => /insert into "audit_logs"/i.test(q.text)).length;
    info(`OTHER 5 anos: ${String(audits)} INSERT em audit_logs por pedido (1 REPORT_VIEW + 1 HEALTH_VIEW por leitura/página)`);
    expect(audits).toBeGreaterThan(1);
  });

  it("sem N+1 por tomas: as consultas crescem com as PÁGINAS (100 tomas) e não com as tomas; custo por página limitado", async () => {
    const small = await measure("membro pequeno (1 toma, 1 exame, 1 consulta, 1 receita)", () => member(d.owner, d.fam, d.mSmall));
    const large = await measure("membro grande, 12 meses", () => member(d.owner, d.fam, d.mLarge, ""));
    const full = await measure("membro grande, 5 anos", () => member(d.owner, d.fam, d.mLarge));
    // Páginas de 100 tomas lidas a mais em 5 anos do que em 12 meses (o total vem da própria resposta).
    const counted = (b: any) => b.medication.overall.taken + b.medication.overall.notTaken + b.medication.overall.unconfirmed;
    const extraPages = Math.ceil(counted(full.body) / 100) - Math.ceil(counted(large.body) / 100);
    info(`tomas: 12 meses=${String(counted(large.body))}, 5 anos=${String(counted(full.body))} => ${String(extraPages)} páginas a mais`);
    const perDosePage = (full.queries - large.queries) / extraPages;
    info(`custo por página de tomas ≈ ${perDosePage.toFixed(1)} instruções (5 anos vs 12 meses)`);
    expect(full.queries).toBeLessThan(2000 / 4); // muito abaixo de «uma instrução por toma»
    expect(perDosePage).toBeLessThanOrEqual(12);
    info(`instruções: pequeno=${String(small.queries)}, grande 12m=${String(large.queries)}, grande 5a=${String(full.queries)}`);
  });

  it("N+1 residual nas leituras de exames e receitas (uma/duas instruções por registo): documenta o custo e fixa um teto", async () => {
    // O membro grande tem 40 exames e 30 receitas; o pequeno 1 e 1. A diferença de consultas por registo extra mostra o custo das vistas compostas
    // (resultados e documentos por exame; planos e documentos por receita), idêntico ao dos endpoints GET de cada módulo.
    const small = await measure("pequeno", () => member(d.owner, d.fam, d.mSmall), 3);
    const large = await measure("grande 5 anos", () => member(d.owner, d.fam, d.mLarge), 3);
    const perExam = large.statements.filter((q) => /from "exam_results"/i.test(q.text)).length;
    const perExamDocs = large.statements.filter((q) => /from "documents"/i.test(q.text) && q.text.includes('examination_id')).length;
    const rxPlans = large.statements.filter((q) => /from "medication_plans"/i.test(q.text) && q.text.includes('prescription_id')).length;
    info(`leituras por registo no membro grande: exam_results=${String(perExam)} (40 exames), documents(exame)=${String(perExamDocs)}, medication_plans(por receita)=${String(rxPlans)} (30 receitas); pequeno: ${String(small.queries)} instruções`);
    // Teto: nunca mais do que 3 instruções por exame/receita (resultados+documentos / planos+documentos) em todo o pedido.
    expect(large.queries - small.queries).toBeLessThan((40 + 30) * 3 + 40 * 12);
  });

  it("vista da família com o membro grande e os restantes: tempo e consultas", async () => {
    const r = await measure("família (3 membros, um deles com 5 anos de dados)", () => family(d.owner, d.fam), 3);
    expect(r.ms).toBeLessThan(6000);
    expect(r.body.members.length).toBeGreaterThanOrEqual(2);
  });

  it("EXPLAIN das instruções reais com tabelas povoadas (60 mil tomas de outros membros): sem varrimento sequencial em dose_occurrences", async () => {
    // Enche `dose_occurrences`, `alerts` e `exam_results` de outros membros para o planificador decidir como em produção.
    const otherFam = await s.family();
    const otherUser = await s.user("perf-filler");
    const otherMember = await s.member(otherFam, { userId: otherUser.id, role: "FAMILY_ADMIN" });
    const plan = await s.plan({ familyId: otherFam, memberId: otherMember, startAt: new Date("2021-01-01T00:00:00Z") });
    await s.h.pool.query(
      `INSERT INTO dose_occurrences (family_id, member_id, plan_id, scheduled_at, status, created_at)
       SELECT $1, $2, $3, timestamptz '2020-01-01' + g * interval '10 minutes', 'TAKEN', date_trunc('milliseconds', now()) FROM generate_series(1, 60000) g`,
      [otherFam, otherMember, plan],
    );
    await s.h.pool.query("ANALYZE");
    recorder.reset();
    const res = await member(d.reader, d.fam, d.mLarge);
    expect(res.status).toBe(200);
    const statements = recorder.dataStatements();
    const interesting = statements.filter((q) => /^\s*select/i.test(q.text) && /from "(dose_occurrences|examinations|exam_results|appointments|alerts|prescriptions|medication_plans)"/i.test(q.text));
    const seen = new Set<string>();
    const plans: string[] = [];
    for (const q of interesting) {
      const table = /from "(\w+)"/i.exec(q.text)?.[1] ?? "?";
      const key = `${table}:${q.text.replace(/\$\d+/g, "$").length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const explain = await s.h.pool.query<{ "QUERY PLAN": any[] }>(`EXPLAIN (FORMAT JSON) ${q.text}`, q.values);
      const text = JSON.stringify(explain.rows[0]?.["QUERY PLAN"]);
      const nodes = [...text.matchAll(/"Node Type":"([^"]+)"/g)].map((m) => m[1]);
      const rels = [...text.matchAll(/"Relation Name":"([^"]+)"/g)].map((m) => m[1]);
      plans.push(`${table}: ${[...new Set(nodes)].join(" > ")} (${[...new Set(rels)].join(",")})`);
      const seqScans = [...text.matchAll(/"Node Type":"Seq Scan"[^{}]*?"Relation Name":"(\w+)"/g)].map((m) => m[1]);
      if (seqScans.length > 0) info(`varrimento sequencial em: ${seqScans.join(", ")} (consulta a ${table})`);
      // Só `dose_occurrences` tem volume que justifique a exigência (62 mil linhas); as restantes tabelas deste cenário são pequenas (o planificador faz
      // bem em varrê-las; o índice de `alerts` com 30 mil linhas está verificado em health-summary-data).
      expect(seqScans, `${table}: ${q.text}`).not.toContain("dose_occurrences");
    }
    info(`planos: ${plans.join(" | ")}`);
    expect(plans.length).toBeGreaterThan(3);
  });
});
