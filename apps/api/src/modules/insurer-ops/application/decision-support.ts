// Erro comum das decisões: a transição é um `UPDATE … WHERE status = …` e a perdida é `409 INVALID_STATE_TRANSITION` (BR-AUT-17).
import { DomainError } from "../../../platform/errors/index.js";

export function conflictOnDecisionLost(): DomainError {
  return new DomainError("INVALID_STATE_TRANSITION", { detail: "O pedido não está num estado que permita esta ação." });
}
