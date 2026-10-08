// Vista `Family` + papel do pedinte (components.schemas.Family, openapi.yaml) — partilhada pelos
// casos de uso de família (não é "domain": combina a entidade com um dado do pedido, `myRole`).
import type { Family } from "../domain/family.js";
import type { FamilyRole } from "../domain/member.js";

export interface FamilyView {
  id: string;
  name: string;
  myRole: FamilyRole;
  createdAt: Date;
}

export function toFamilyView(family: Family, myRole: FamilyRole): FamilyView {
  return { id: family.id, name: family.name, myRole, createdAt: family.createdAt };
}
