import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { insurancePortalService } from '@/services/insurancePortal.service'
import { DEFAULT_CURRENCY } from '@/lib/insurerFormat'
import type { InsurancePortalMe, InsuranceSession } from '@/types/insurance'

/**
 * Sessão do **portal da seguradora** (`InsuranceAccount`, ADR-021): paralela e independente do
 * `AuthContext` da app e do `ClinicAuthContext`. Só envolve a árvore de rotas `/insurance/*`.
 */
interface InsuranceAuthContextValue {
  status: 'loading' | 'ready'
  session: InsuranceSession | null
  /** `GET /insurance-portal/me`; `null` enquanto carrega ou se falhar (a UI segue com os valores por omissão). */
  me: InsurancePortalMe | null
  /** Moeda da seguradora (BR-SEG-19); kwanza até o `/me` chegar. */
  currency: string
  /** `false` só quando o `/me` diz que o módulo operacional está desativado: esconde os separadores (o servidor decide). */
  moduleEnabled: boolean
  /** Só o Admin da seguradora gere os Agentes (BR-INS-06). */
  isAdmin: boolean
  /** Módulo operacional (§8.2b): Admin e Gestor de beneficiários escrevem em beneficiários, apólices, importações e ligações. */
  isOps: boolean
  /** Pedidos de reembolso (§8.2): Admin e Agente; o Gestor de beneficiários não os vê. */
  canSeeClaims: boolean
  /** Fila de autorizações, detalhe e métricas (§8.2b/§8.2d): Admin, Analista, Gestores de despesas/financeiro e Supervisor leem. */
  canSeeAuthorizations: boolean
  /** Analista e Supervisor decidem (o que cada um pode fazer em cada pedido vem do servidor em `allowedActions`). */
  isAnalyst: boolean
  isSupervisor: boolean
  /** Regras de aprovação automática: lê o Supervisor, o Admin e o Analista; só o Supervisor altera (§8.2d). */
  canSeeRules: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const InsuranceAuthContext = createContext<InsuranceAuthContextValue | null>(null)

export function InsuranceAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<InsuranceAuthContextValue['status']>('loading')
  const [session, setSession] = useState<InsuranceSession | null>(null)
  const [me, setMe] = useState<InsurancePortalMe | null>(null)
  const insurerId = session?.insurerId

  useEffect(() => {
    let active = true
    insurancePortalService
      .restore()
      .catch(() => null)
      .then((restored) => {
        if (!active) return
        setSession(restored)
        setStatus('ready')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!insurerId) {
      setMe(null)
      return
    }
    let active = true
    insurancePortalService.getMe().then(
      (next) => active && setMe(next),
      () => active && setMe(null),
    )
    return () => {
      active = false
    }
  }, [insurerId])

  const login = useCallback(async (email: string, password: string) => {
    setSession(await insurancePortalService.login(email, password))
    setStatus('ready')
  }, [])

  const logout = useCallback(async () => {
    await insurancePortalService.logout().catch(() => undefined)
    setSession(null)
  }, [])

  const value = useMemo<InsuranceAuthContextValue>(
    () => {
      const role = session?.role
      return {
        status,
        session,
        me,
        currency: me?.currency ?? DEFAULT_CURRENCY,
        moduleEnabled: me?.operationalModuleEnabled ?? true,
        isAdmin: role === 'INSURANCE_ADMIN',
        isOps: role === 'INSURANCE_ADMIN' || role === 'BENEFICIARY_MANAGER',
        canSeeClaims: role === 'INSURANCE_ADMIN' || role === 'INSURANCE_AGENT',
        canSeeAuthorizations: role === 'INSURANCE_ADMIN' || role === 'AUTHORIZATION_ANALYST' || role === 'CLAIMS_MANAGER' || role === 'FINANCE_MANAGER' || role === 'SUPERVISOR',
        isAnalyst: role === 'AUTHORIZATION_ANALYST',
        isSupervisor: role === 'SUPERVISOR',
        canSeeRules: role === 'INSURANCE_ADMIN' || role === 'AUTHORIZATION_ANALYST' || role === 'SUPERVISOR',
        login,
        logout,
      }
    },
    [status, session, me, login, logout],
  )

  return <InsuranceAuthContext.Provider value={value}>{children}</InsuranceAuthContext.Provider>
}

export function useInsuranceAuth(): InsuranceAuthContextValue {
  const context = useContext(InsuranceAuthContext)
  if (!context) throw new Error('useInsuranceAuth tem de ser usado dentro de <InsuranceAuthProvider>')
  return context
}
