// Handler de segurança por defeito do validador OpenAPI: falha fechado em qualquer rota protegida
// (`security: [bearerAuth: []]`) até o módulo `auth` (M1) substituir por um handler real.
export function denyAllSecurityHandler(): Promise<boolean> {
  // O validador converte qualquer rejeição/erro do handler num 401 — ver error-middleware.ts.
  return Promise.reject(new Error("Autenticação ainda não disponível (módulo auth é M1)."));
}
