import { createContext } from 'react'

/** Alertas por ler, calculados pelo AppShell e mostrados no menu e na sidebar. */
export const UnreadAlertsContext = createContext(0)

/** Volta a contar os alertas por ler (ex.: depois de marcar como lido). */
export const RefreshUnreadAlertsContext = createContext<() => void>(() => {})
