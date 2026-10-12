// Access token JWT do portal da clínica (ADR-020): claims distintas e nunca confundíveis com o
// token de `User` — `cid` (clinicAccountId) + `csid` (sessionId do portal), nunca `sub`/`sid` nem
// `userId`/`familyId` (endpoints.md topo, authorization.md §1). `clinicId`/`role` NÃO vão no token
// (podem mudar a qualquer momento, ex. suspensão de um `CLINIC_MANAGER`) — são resolvidos por
// pedido a partir da BD, com cache curta (ver application/resolve-clinic-actor-state.ts), mesmo
// critério de `auth/application/resolve-actor-state.ts` para `authorization.md` §6.1 passo 1
// ("ClinicAccount.status ≠ ACTIVE ⇒ DENY" tem de refletir suspensões em tempo real, não só no
// momento do login). Duplicado deliberadamente de `auth/domain/jwt.ts` (CLAUDE.md: identidade
// separada) — `jose` é computação criptográfica pura, sem I/O (conventions.md §3.9).
import { jwtVerify, SignJWT, errors as joseErrors } from "jose";
import { DomainError, UnauthenticatedError } from "../../../platform/errors/index.js";

export interface ClinicSigningKey {
  kid: string;
  secret: Uint8Array;
}

export interface ClinicAccessTokenResult {
  token: string;
  expiresIn: number;
}

export interface ClinicAccessTokenSubject {
  clinicAccountId: string;
  sessionId: string;
}

/**
 * Mesmo formato de `JWT_SIGNING_KEYS` de `auth` (environment.md §2) — reutiliza o mesmo valor de
 * configuração (`main/api.ts` chama esta função separadamente, sem importar `modules/auth`).
 */
export function parseClinicSigningKeys(raw: string): ClinicSigningKey[] {
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

export async function signClinicAccessToken(params: {
  subject: ClinicAccessTokenSubject;
  now: Date;
  ttlSeconds: number;
  signingKeys: ClinicSigningKey[];
}): Promise<ClinicAccessTokenResult> {
  const current = params.signingKeys[0];
  if (!current) {
    throw new Error("Sem chave de assinatura JWT configurada.");
  }
  const iat = Math.floor(params.now.getTime() / 1000);
  const exp = iat + params.ttlSeconds;
  const token = await new SignJWT({ cid: params.subject.clinicAccountId, csid: params.subject.sessionId })
    .setProtectedHeader({ alg: "HS256", kid: current.kid })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(current.secret);
  return { token, expiresIn: params.ttlSeconds };
}

/** Lança `TOKEN_EXPIRED` se só o prazo tiver passado, senão `UNAUTHENTICATED`. */
export async function verifyClinicAccessToken(
  token: string,
  signingKeys: ClinicSigningKey[],
  now: Date,
): Promise<ClinicAccessTokenSubject> {
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
    const { cid, csid } = payload;
    if (typeof cid !== "string" || typeof csid !== "string") {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }
    return { clinicAccountId: cid, sessionId: csid };
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
