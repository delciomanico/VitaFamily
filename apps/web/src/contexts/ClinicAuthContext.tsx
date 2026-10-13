import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { clinicPortalService } from '@/services/clinicPortal.service'
import type { ClinicSession } from '@/types/clinic'

/**
 * Sessão do **portal da clínica** (`ClinicAccount`, ADR-020) — deliberadamente paralela e
 * independente do `AuthContext` da app de família:
 *
 * - identidades diferentes: `ClinicAccount` não é `User`, não tem família nem membro;
 * - tokens diferentes: o access token vive em `clinicApiClient`, e o refresh no cookie
 *   `clinic_refresh_token`, nunca no `refresh_token` de `User`;
 * - armazenamentos diferentes no browser (`vf.clinic.session.*`), pelo que entrar ou sair de um
 *   dos mundos não afeta o outro.
 *
 * Este provider só envolve a árvore de rotas `/clinic/*`: nenhuma página da app de família lê
 * esta sessão, e nenhuma página do portal lê a de `User`.
 */
interface ClinicAuthContextValue {
  status: 'loading' | 'ready'
  session: ClinicSession | null
  /** Só o Admin da clínica gere os Gestores (BR-CLN-05). */
  isAdmin: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const ClinicAuthContext = createContext<ClinicAuthContextValue | null>(null)

export function ClinicAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ClinicAuthContextValue['status']>('loading')
  const [session, setSession] = useState<ClinicSession | null>(null)

  // Retoma a sessão ao abrir o portal: na API real por `POST /clinic-portal/auth/refresh`
  // (cookie próprio); no backend simulado pela conta guardada na aba.
  useEffect(() => {
    let active = true
    clinicPortalService
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
    setSession(await clinicPortalService.login(email, password))
    setStatus('ready')
  }, [])

  const logout = useCallback(async () => {
    await clinicPortalService.logout().catch(() => undefined)
    setSession(null)
  }, [])

  const value = useMemo<ClinicAuthContextValue>(
    () => ({ status, session, isAdmin: session?.role === 'CLINIC_ADMIN', login, logout }),
    [status, session, login, logout],
  )

  return <ClinicAuthContext.Provider value={value}>{children}</ClinicAuthContext.Provider>
}

export function useClinicAuth(): ClinicAuthContextValue {
  const context = useContext(ClinicAuthContext)
  if (!context) throw new Error('useClinicAuth tem de ser usado dentro de <ClinicAuthProvider>')
  return context
}
