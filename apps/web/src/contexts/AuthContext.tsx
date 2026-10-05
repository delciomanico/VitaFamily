import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isAppError } from '@/lib/errors'
import { sessionStore } from '@/lib/storage'
import { authService, type RegisterInput } from '@/services/auth.service'
import { clinicPortalService } from '@/services/clinicPortal.service'
import { familyService } from '@/services/family.service'
import type { Clinic } from '@/types/clinic'
import type { Family, FamilyMember, Membership } from '@/types/family'
import type { User } from '@/types/user'

interface AuthState {
  status: 'loading' | 'ready'
  user: User | null
  membership: Membership | null
  /** Clínica parceira gerida pelo utilizador (portal da clínica, D17). */
  clinic: Clinic | null
  /** E-mail à espera do código de verificação (após registo ou login não verificado). */
  pendingEmail: string | null
}

interface AuthContextValue {
  status: AuthState['status']
  user: User | null
  family: Family | null
  /** Perfil de membro do próprio utilizador na família ativa. */
  member: FamilyMember | null
  /** Clínica parceira, quando o utilizador é Gestor da clínica (D17). */
  clinic: Clinic | null
  pendingEmail: string | null
  login: (email: string, password: string) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  verify: (code: string) => Promise<void>
  resendCode: () => Promise<void>
  createFamily: (name: string) => Promise<void>
  joinFamily: (code: string) => Promise<void>
  refreshMembership: () => Promise<void>
  /** Atualiza a conta em sessão depois de a alterar (nome, fuso). */
  setUser: (user: User) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const initialState: AuthState = { status: 'loading', user: null, membership: null, clinic: null, pendingEmail: null }

const normalizeEmail = (email: string) => email.trim().toLowerCase()

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState)

  const signIn = useCallback(async (user: User) => {
    const [membership, clinic] = await Promise.all([
      familyService.getMembership(user.id),
      clinicPortalService.getClinicMembership(user.id),
    ])
    sessionStore.setUserId(user.id)
    setState({ status: 'ready', user, membership, clinic, pendingEmail: null })
  }, [])

  // Restaura a sessão mock do separador atual (só o id do utilizador é guardado).
  useEffect(() => {
    const userId = sessionStore.getUserId()
    if (!userId) {
      setState((s) => ({ ...s, status: 'ready' }))
      return
    }
    authService
      .getUser(userId)
      .then((user) => (user ? signIn(user) : Promise.reject(new Error('sessão inválida'))))
      .catch(() => {
        sessionStore.setUserId(null)
        setState((s) => ({ ...s, status: 'ready' }))
      })
  }, [signIn])

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        await signIn(await authService.login({ email, password }))
      } catch (error) {
        if (isAppError(error, 'EMAIL_NOT_VERIFIED')) {
          setState((s) => ({ ...s, pendingEmail: normalizeEmail(email) }))
        }
        throw error
      }
    },
    [signIn],
  )

  const register = useCallback(async (input: RegisterInput) => {
    await authService.register(input)
    setState((s) => ({ ...s, pendingEmail: normalizeEmail(input.email) }))
  }, [])

  const verify = useCallback(
    async (code: string) => {
      if (!state.pendingEmail) return
      await signIn(await authService.verifyEmail(state.pendingEmail, code))
    },
    [signIn, state.pendingEmail],
  )

  const resendCode = useCallback(async () => {
    if (state.pendingEmail) await authService.resendVerificationCode(state.pendingEmail)
  }, [state.pendingEmail])

  const setMembership = (membership: Membership | null) => setState((s) => ({ ...s, membership }))

  const createFamily = useCallback(
    async (name: string) => {
      if (state.user) setMembership(await familyService.createFamily(state.user.id, name))
    },
    [state.user],
  )

  const joinFamily = useCallback(
    async (code: string) => {
      if (state.user) setMembership(await familyService.joinFamily(state.user.id, code))
    },
    [state.user],
  )

  const refreshMembership = useCallback(async () => {
    if (state.user) setMembership(await familyService.getMembership(state.user.id))
  }, [state.user])

  const setUser = useCallback((user: User) => setState((s) => ({ ...s, user })), [])

  const logout = useCallback(() => {
    sessionStore.setUserId(null)
    setState({ status: 'ready', user: null, membership: null, clinic: null, pendingEmail: null })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.user,
      family: state.membership?.family ?? null,
      member: state.membership?.member ?? null,
      clinic: state.clinic,
      pendingEmail: state.pendingEmail,
      login,
      register,
      verify,
      resendCode,
      createFamily,
      joinFamily,
      refreshMembership,
      setUser,
      logout,
    }),
    [state, login, register, verify, resendCode, createFamily, joinFamily, refreshMembership, setUser, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth tem de ser usado dentro de <AuthProvider>')
  return context
}
