import { useSyncExternalStore } from 'react'

/**
 * Foto de perfil do profissional: opcional e **só neste dispositivo** (modo demonstração; o contrato ainda não tem
 * upload de imagem de perfil). Sem foto, o avatar mostra as iniciais.
 */
const keyOf = (professionalId: string) => `vf.professional.photo.${professionalId}`
const EVENT = 'vf:professional-photo'
const MAX_RAW_BYTES = 300_000
const SIZE = 256

export function readProfessionalPhoto(professionalId: string): string | null {
  try {
    return window.localStorage.getItem(keyOf(professionalId))
  } catch {
    return null
  }
}

export function saveProfessionalPhoto(professionalId: string, dataUrl: string | null): void {
  try {
    if (dataUrl) window.localStorage.setItem(keyOf(professionalId), dataUrl)
    else window.localStorage.removeItem(keyOf(professionalId))
  } catch {
    throw new Error('Não foi possível guardar a foto neste dispositivo.')
  }
  window.dispatchEvent(new Event(EVENT))
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
    reader.readAsDataURL(file)
  })
}

/** Reduz a imagem a um quadrado pequeno (corte ao centro) para caber no armazenamento do dispositivo. */
export async function photoToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha uma imagem (JPG ou PNG).')
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE
      const context = canvas.getContext('2d')
      if (context) {
        const side = Math.min(bitmap.width, bitmap.height)
        context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE)
        return canvas.toDataURL('image/jpeg', 0.85)
      }
    } catch {
      // Cai para a leitura direta abaixo.
    }
  }
  if (file.size > MAX_RAW_BYTES) throw new Error('A imagem é muito grande. Escolha uma mais pequena.')
  return readAsDataUrl(file)
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

export function useProfessionalPhoto(professionalId: string | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (professionalId ? readProfessionalPhoto(professionalId) : null),
    () => null,
  )
}
