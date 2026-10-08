// Mapeamento User (domain) -> forma da API (`components.schemas.User`, openapi.yaml).
import type { UserView } from "../application/get-me.js";

export interface UserResponseBody {
  id: string;
  email: string;
  name: string;
  birthDate: string;
  timezone: string;
  status: string;
  platformRole: string;
  termsAcceptedVersion: string;
  termsReacceptanceRequired: boolean;
  createdAt: string;
}

export function toUserResponse(user: UserView): UserResponseBody {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    birthDate: user.birthDate,
    timezone: user.timezone,
    status: user.status,
    platformRole: user.platformRole,
    termsAcceptedVersion: user.termsAcceptedVersion,
    termsReacceptanceRequired: user.termsReacceptanceRequired,
    createdAt: user.createdAt.toISOString(),
  };
}
