import { describe, expect, it } from "vitest";
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
import { assertValidAppointmentTransition, assertValidCreationStatus, type AppointmentStatus } from "./appointment.js";

describe("assertValidAppointmentTransition (ST4/D17, state-machines.md)", () => {
  it.each<[AppointmentStatus, AppointmentStatus]>([
    ["SCHEDULED", "COMPLETED"],
    ["SCHEDULED", "NO_SHOW"],
    ["SCHEDULED", "CANCELLED"],
    ["CANCELLED", "SCHEDULED"],
    ["COMPLETED", "NO_SHOW"],
    ["NO_SHOW", "COMPLETED"],
    ["SCHEDULED", "SCHEDULED"],
    ["COMPLETED", "COMPLETED"],
    ["REQUESTED", "SCHEDULED"],
    ["REQUESTED", "REJECTED"],
    ["REQUESTED", "CANCELLED"],
    ["REQUESTED", "REQUESTED"],
    ["REJECTED", "REJECTED"],
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
    ["REJECTED", "SCHEDULED"],
    ["REJECTED", "REQUESTED"],
    ["SCHEDULED", "REQUESTED"],
    ["CANCELLED", "REQUESTED"],
  ])("recusa %s -> %s", (from, to) => {
    expect(() => {
      assertValidAppointmentTransition(from, to);
    }).toThrow(DomainError);
  });
});

describe("assertValidCreationStatus (UC-APT-01/UC-APT-07, D17)", () => {
  it("aceita SCHEDULED e COMPLETED sem slotId", () => {
    expect(() => {
      assertValidCreationStatus("SCHEDULED", false);
    }).not.toThrow();
    expect(() => {
      assertValidCreationStatus("COMPLETED", false);
    }).not.toThrow();
  });

  it("recusa NO_SHOW/CANCELLED na criação sem slotId", () => {
    expect(() => {
      assertValidCreationStatus("NO_SHOW", false);
    }).toThrow(ValidationError);
    expect(() => {
      assertValidCreationStatus("CANCELLED", false);
    }).toThrow(ValidationError);
  });

  it("recusa SCHEDULED/COMPLETED com slotId (nasce sempre REQUESTED)", () => {
    expect(() => {
      assertValidCreationStatus("SCHEDULED", true);
    }).toThrow(ValidationError);
    expect(() => {
      assertValidCreationStatus("COMPLETED", true);
    }).toThrow(ValidationError);
  });

  it("aceita REQUESTED só com slotId", () => {
    expect(() => {
      assertValidCreationStatus("REQUESTED", true);
    }).not.toThrow();
    expect(() => {
      assertValidCreationStatus("REQUESTED", false);
    }).toThrow(ValidationError);
  });
});
