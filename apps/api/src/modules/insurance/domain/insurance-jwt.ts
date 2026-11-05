// Access token JWT do portal da seguradora (ADR-021): claims `iid` (insuranceAccountId) + `isid`
// (sessionId do portal), distintas das de User (`sub`/`sid`) e de clínica (`cid`/`csid`): um token
// nunca é aceite no esquema de outro, mesmo com a mesma chave de assinatura. `insurerId`/`role` NÃO
// vão no token (podem mudar, ex. suspensão) — resolvem-se por pedido (resolve-insurance-actor-state).
import { jwtVerify, SignJWT, errors as joseErrors } from "jose";
import { DomainError, UnauthenticatedError } from "../../../platform/errors/index.js";

export interface InsuranceSigningKey {
  kid: string;
  secret: Uint8Array;
}

export interface InsuranceAccessTokenSubject {
  insuranceAccountId: string;
  sessionId: string;
}

/** Mesmo formato de `JWT_SIGNING_KEYS` de `auth` (environment.md §2); parser próprio (sem importar `auth`). */
export function parseInsuranceSigningKeys(raw: string): InsuranceSigningKey[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error("JWT_SIGNING_KEYS: JSON inválido.", { cause });
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("JWT_SIGNING_KEYS: esperada uma lista não vazia de { kid, secret }.");
  }
  return parsed.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`JWT_SIGNING_KEYS[${String(index)}]: entrada inválida.`);
    }
    const { kid, secret } = entry as Record<string, unknown>;
    if (typeof kid !== "string" || kid.length === 0) {
      throw new Error(`JWT_SIGNING_KEYS[${String(index)}].kid inválido.`);
    }
    if (typeof secret !== "string" || secret.length < 32) {
      throw new Error(`JWT_SIGNING_KEYS[${String(index)}].secret inválido (mín. 32 caracteres).`);
    }
    return { kid, secret: new TextEncoder().encode(secret) };
  });
}

export async function signInsuranceAccessToken(params: {
  subject: InsuranceAccessTokenSubject;
  now: Date;
  ttlSeconds: number;
  signingKeys: InsuranceSigningKey[];
}): Promise<{ token: string; expiresIn: number }> {
  const current = params.signingKeys[0];
  if (!current) {
    throw new Error("Sem chave de assinatura JWT configurada.");
  }
  const iat = Math.floor(params.now.getTime() / 1000);
  const token = await new SignJWT({ iid: params.subject.insuranceAccountId, isid: params.subject.sessionId })
    .setProtectedHeader({ alg: "HS256", kid: current.kid })
    .setIssuedAt(iat)
    .setExpirationTime(iat + params.ttlSeconds)
    .sign(current.secret);
  return { token, expiresIn: params.ttlSeconds };
}

/** Lança `TOKEN_EXPIRED` se só o prazo tiver passado, senão `UNAUTHENTICATED`. */
export async function verifyInsuranceAccessToken(
  token: string,
  signingKeys: InsuranceSigningKey[],
  now: Date,
): Promise<InsuranceAccessTokenSubject> {
  const keyByKid = new Map(signingKeys.map((k) => [k.kid, k.secret]));
  try {
    const { payload } = await jwtVerify(
      token,
      (header) => {
        const key = typeof header.kid === "string" ? keyByKid.get(header.kid) : undefined;
        if (!key) {
          throw new UnauthenticatedError({ detail: "Sem sessão válida." });
        }
        return key;
      },
      { algorithms: ["HS256"], currentDate: now },
    );
    const { iid, isid } = payload;
    if (typeof iid !== "string" || typeof isid !== "string") {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }
    return { insuranceAccountId: iid, sessionId: isid };
  } catch (cause) {
    if (cause instanceof joseErrors.JWTExpired) {
      throw new DomainError("TOKEN_EXPIRED", { detail: "Sessão expirada.", cause });
    }
    if (cause instanceof DomainError) {
      throw cause;
    }
    throw new UnauthenticatedError({ detail: "Sem sessão válida.", cause });
  }
}
