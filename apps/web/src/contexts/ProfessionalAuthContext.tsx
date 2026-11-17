import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { professionalPortalService } from '@/services/professionalPortal.service'
import type { ProfessionalSession } from '@/types/professional'

/**
 * Sessão do **portal do profissional** (`ProfessionalAccount`, ADR-037), paralela e independente do
 * `AuthContext` (família) e do `ClinicAuthContext`: identidade, token (só em memória), cookie de refresh e
 * chave de armazenamento próprios. Só envolve a árvore `/profissional/*`.
 *
 * O estado de validação aqui é só o do login; as páginas leem o perfil (`getMe`) por pedido, porque quem
 * decide o que é permitido é o servidor (authorization.md §10.1, passo 4) — nunca o token.
 */
interface ProfessionalAuthContextValue {
  status: 'loading' | 'ready'
  session: ProfessionalSession | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const ProfessionalAuthContext = createContext<ProfessionalAuthContextValue | null>(null)

export function ProfessionalAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ProfessionalAuthContextValue['status']>('loading')
  const [session, setSession] = useState<ProfessionalSession | null>(null)

  useEffect(() => {
    let active = true
    professionalPortalService
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
    setSession(await professionalPortalService.login(email, password))
    setStatus('ready')
  }, [])

  const logout = useCallback(async () => {
    await professionalPortalService.logout().catch(() => undefined)
    setSession(null)
  }, [])

  const value = useMemo(() => ({ status, session, login, logout }), [status, session, login, logout])
  return <ProfessionalAuthContext.Provider value={value}>{children}</ProfessionalAuthContext.Provider>
}

export function useProfessionalAuth(): ProfessionalAuthContextValue {
  const context = useContext(ProfessionalAuthContext)
  if (!context) throw new Error('useProfessionalAuth tem de ser usado dentro de <ProfessionalAuthProvider>')
  return context
}
