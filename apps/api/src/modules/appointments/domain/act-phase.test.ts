// TC-PRC-08 (BR-PRC-04): projeção estado da consulta -> `phase`.
import { describe, expect, it } from "vitest";
import { projectActPhase, type ActPhase } from "./act-phase.js";
import type { AppointmentStatus } from "./appointment.js";

const WHEN = new Date("2026-01-15T10:00:00Z");

describe("projectActPhase (consultas)", () => {
  it.each<[string, AppointmentStatus, { arrivedAt?: Date; startedAt?: Date }, ActPhase]>([
    ["REQUESTED", "REQUESTED", {}, "PENDING"],
    ["SCHEDULED sem chegada", "SCHEDULED", {}, "SCHEDULED"],
    ["SCHEDULED com arrivedAt", "SCHEDULED", { arrivedAt: WHEN }, "IN_PROGRESS"],
    ["SCHEDULED só com startedAt", "SCHEDULED", { startedAt: WHEN }, "IN_PROGRESS"],
    ["COMPLETED", "COMPLETED", {}, "DONE"],
    ["NO_SHOW", "NO_SHOW", {}, "NO_SHOW"],
    ["CANCELLED", "CANCELLED", {}, "CANCELLED"],
    ["REJECTED", "REJECTED", {}, "CANCELLED"],
  ])("%s => %s", (_name, status, flow, expected) => {
    expect(projectActPhase({ status, ...flow })).toBe(expected);
  });

  it("a chegada só conta em SCHEDULED (uma consulta concluída continua DONE)", () => {
    expect(projectActPhase({ status: "COMPLETED", arrivedAt: WHEN, startedAt: WHEN })).toBe("DONE");
  });
});
