import { useEffect, useState } from 'react'
import { aiService } from '@/services/ai.service'

/** `true` só quando o servidor tem o assistente ligado (M18, `AI_ASSISTANT_ENABLED`); até saber, `false` (nada aparece). */
export function useAiEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let active = true
    void aiService.isEnabled().then((value) => active && setEnabled(value))
    return () => {
      active = false
    }
  }, [])
  return enabled
}
