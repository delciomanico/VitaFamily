import { describe, expect, it } from "vitest";
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
import { assertValidAppointmentTransition, assertValidCreationStatus, type AppointmentStatus } from "./appointment.js";

describe("assertValidAppointmentTransition (ST4, state-machines.md)", () => {
  it.each<[AppointmentStatus, AppointmentStatus]>([
    ["SCHEDULED", "COMPLETED"],
    ["SCHEDULED", "NO_SHOW"],
    ["SCHEDULED", "CANCELLED"],
    ["CANCELLED", "SCHEDULED"],
    ["COMPLETED", "NO_SHOW"],
    ["NO_SHOW", "COMPLETED"],
    ["SCHEDULED", "SCHEDULED"],
    ["COMPLETED", "COMPLETED"],
  ])("permite %s -> %s", (from, to) => {
    expect(() => {
      assertValidAppointmentTransition(from, to);
    }).not.toThrow();
  });

  it.each<[AppointmentStatus, AppointmentStatus]>([
    ["COMPLETED", "SCHEDULED"],
    ["NO_SHOW", "SCHEDULED"],
    ["CANCELLED", "COMPLETED"],
    ["CANCELLED", "NO_SHOW"],
  ])("recusa %s -> %s", (from, to) => {
    expect(() => {
      assertValidAppointmentTransition(from, to);
    }).toThrow(DomainError);
  });
});

describe("assertValidCreationStatus (UC-APT-01)", () => {
  it("aceita SCHEDULED e COMPLETED", () => {
    expect(() => {
      assertValidCreationStatus("SCHEDULED");
    }).not.toThrow();
    expect(() => {
      assertValidCreationStatus("COMPLETED");
    }).not.toThrow();
  });

  it("recusa NO_SHOW/CANCELLED na criação", () => {
    expect(() => {
      assertValidCreationStatus("NO_SHOW");
    }).toThrow(ValidationError);
    expect(() => {
      assertValidCreationStatus("CANCELLED");
    }).toThrow(ValidationError);
  });
});
