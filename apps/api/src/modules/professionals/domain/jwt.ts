// Access token JWT do portal do profissional (BR-MKT-13/29, authentication.md §5): claims `professionalAccountId`/`professionalId`/`sid`
// e `aud = professional-portal` (OP-73, omissão: mesma chave com `aud` distinto). NUNCA `sub`/`userId`/`cid`: um token de User ou de
// clínica não valida aqui, e este não valida em `auth` (exige `sub`) nem em `clinics` (exige `cid`/`csid`). O estado de validação NÃO vai
// no token. `jose` é computação criptográfica pura (conventions.md §3.9).
import { jwtVerify, SignJWT, errors as joseErrors } from "jose";
import { DomainError, UnauthenticatedError } from "../../../platform/errors/index.js";

export const PROFESSIONAL_JWT_AUDIENCE = "professional-portal";

export interface ProfessionalSigningKey {
  kid: string;
  secret: Uint8Array;
}

export interface ProfessionalTokenSubject {
  professionalAccountId: string;
  professionalId: string;
  sessionId: string;
}

/** Mesmo formato de `JWT_SIGNING_KEYS` (environment.md §2); `main/api.ts` chama-a sem importar `auth`. */
export function parseProfessionalSigningKeys(raw: string): ProfessionalSigningKey[] {
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
    if (typeof entry !== "object" || entry === null) throw new Error(`JWT_SIGNING_KEYS[${String(index)}]: entrada inválida.`);
    const { kid, secret } = entry as Record<string, unknown>;
    if (typeof kid !== "string" || kid.length === 0) throw new Error(`JWT_SIGNING_KEYS[${String(index)}].kid inválido.`);
    if (typeof secret !== "string" || secret.length < 32) throw new Error(`JWT_SIGNING_KEYS[${String(index)}].secret inválido (mín. 32 caracteres).`);
    return { kid, secret: new TextEncoder().encode(secret) };
  });
}

export async function signProfessionalAccessToken(params: {
  subject: ProfessionalTokenSubject;
  now: Date;
  ttlSeconds: number;
  signingKeys: ProfessionalSigningKey[];
}): Promise<{ token: string; expiresIn: number }> {
  const current = params.signingKeys[0];
  if (!current) throw new Error("Sem chave de assinatura JWT configurada.");
  const iat = Math.floor(params.now.getTime() / 1000);
  const token = await new SignJWT({
    professionalAccountId: params.subject.professionalAccountId,
    professionalId: params.subject.professionalId,
    sid: params.subject.sessionId,
  })
    .setProtectedHeader({ alg: "HS256", kid: current.kid })
    .setAudience(PROFESSIONAL_JWT_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + params.ttlSeconds)
    .sign(current.secret);
  return { token, expiresIn: params.ttlSeconds };
}

/** `TOKEN_EXPIRED` se só o prazo passou; qualquer outra falha (assinatura, `aud`, claims em falta) ⇒ `UNAUTHENTICATED`. */
export async function verifyProfessionalAccessToken(token: string, signingKeys: ProfessionalSigningKey[], now: Date): Promise<ProfessionalTokenSubject> {
  const keyByKid = new Map(signingKeys.map((k) => [k.kid, k.secret]));
  try {
    const { payload } = await jwtVerify(
      token,
      (header) => {
        const key = typeof header.kid === "string" ? keyByKid.get(header.kid) : undefined;
        if (!key) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
        return key;
      },
      { algorithms: ["HS256"], currentDate: now, audience: PROFESSIONAL_JWT_AUDIENCE },
    );
    const { professionalAccountId, professionalId, sid } = payload;
    if (typeof professionalAccountId !== "string" || typeof professionalId !== "string" || typeof sid !== "string") {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }
    return { professionalAccountId, professionalId, sessionId: sid };
  } catch (cause) {
    if (cause instanceof joseErrors.JWTExpired) throw new DomainError("TOKEN_EXPIRED", { detail: "Sessão expirada.", cause });
    if (cause instanceof DomainError) throw cause;
    throw new UnauthenticatedError({ detail: "Sem sessão válida.", cause });
  }
}
