import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { insurancePortalService } from '@/services/insurancePortal.service'
import type { InsuranceSession } from '@/types/insurance'

/**
 * Sessão do **portal da seguradora** (`InsuranceAccount`, ADR-021): paralela e independente do
 * `AuthContext` da app e do `ClinicAuthContext`. Só envolve a árvore de rotas `/insurance/*`.
 */
interface InsuranceAuthContextValue {
  status: 'loading' | 'ready'
  session: InsuranceSession | null
  /** Só o Admin da seguradora gere os Agentes (BR-INS-06). */
  isAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const InsuranceAuthContext = createContext<InsuranceAuthContextValue | null>(null)

export function InsuranceAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<InsuranceAuthContextValue['status']>('loading')
  const [session, setSession] = useState<InsuranceSession | null>(null)

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

  const login = useCallback(async (email: string, password: string) => {
    setSession(await insurancePortalService.login(email, password))
    setStatus('ready')
  }, [])

  const logout = useCallback(async () => {
    await insurancePortalService.logout().catch(() => undefined)
    setSession(null)
  }, [])

  const value = useMemo<InsuranceAuthContextValue>(
    () => ({ status, session, isAdmin: session?.role === 'INSURANCE_ADMIN', login, logout }),
    [status, session, login, logout],
  )

  return <InsuranceAuthContext.Provider value={value}>{children}</InsuranceAuthContext.Provider>
}

export function useInsuranceAuth(): InsuranceAuthContextValue {
  const context = useContext(InsuranceAuthContext)
  if (!context) throw new Error('useInsuranceAuth tem de ser usado dentro de <InsuranceAuthProvider>')
  return context
}
