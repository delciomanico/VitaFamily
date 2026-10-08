// Access token JWT (authentication.md §1, ADR-007): HS256, 15 min, claims `sub`/`sid`/`iat`/`exp`
// (sem papéis — lidos da BD por pedido), `kid` no cabeçalho para rotação de chave. `jose` é
// computação criptográfica pura, sem I/O (conventions.md §3.9).
import { jwtVerify, SignJWT, errors as joseErrors } from "jose";
import { UnauthenticatedError, DomainError } from "../../../platform/errors/index.js";

export interface SigningKey {
  kid: string;
  secret: Uint8Array;
}

export interface AccessTokenResult {
  token: string;
  expiresIn: number;
}

export interface AccessTokenSubject {
  userId: string;
  sessionId: string;
}

/**
 * `JWT_SIGNING_KEYS` (environment.md §2) — decisão de formato do módulo `auth` (M1, delegada por
 * `platform/config`): JSON com lista `[{ "kid": "...", "secret": "..." }, ...]`, a primeira é a
 * chave de assinatura atual; as restantes só servem para verificar tokens ainda válidos assinados
 * antes da rotação. `secret` com pelo menos 32 caracteres (256 bits razoáveis para HS256).
 */
export function parseSigningKeys(raw: string): SigningKey[] {
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

/** Assina um access token com a chave atual (`signingKeys[0]`). */
export async function signAccessToken(params: {
  subject: AccessTokenSubject;
  now: Date;
  ttlSeconds: number;
  signingKeys: SigningKey[];
}): Promise<AccessTokenResult> {
  const current = params.signingKeys[0];
  if (!current) {
    throw new Error("Sem chave de assinatura JWT configurada.");
  }
  const iat = Math.floor(params.now.getTime() / 1000);
  const exp = iat + params.ttlSeconds;
  const token = await new SignJWT({ sub: params.subject.userId, sid: params.subject.sessionId })
    .setProtectedHeader({ alg: "HS256", kid: current.kid })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(current.secret);
  return { token, expiresIn: params.ttlSeconds };
}

/**
 * Verifica um access token contra as chaves conhecidas (seleciona por `kid`). `now` vem da porta
 * `Clock` do chamador (conventions.md §2: nunca tempo direto) e é o que decide a expiração — nunca
 * o relógio real do processo. Lança `TOKEN_EXPIRED` se só o prazo tiver passado, senão
 * `UNAUTHENTICATED` (chave desconhecida, assinatura inválida, claims malformadas).
 */
export async function verifyAccessToken(
  token: string,
  signingKeys: SigningKey[],
  now: Date,
): Promise<AccessTokenSubject> {
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
    const { sub, sid } = payload;
    if (typeof sub !== "string" || typeof sid !== "string") {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }
    return { userId: sub, sessionId: sid };
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
