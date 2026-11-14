import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

interface QrCodeProps {
  value: string
  /** Texto alternativo: o conteúdo do QR não se lê em voz alta. */
  label: string
  className?: string
}

/**
 * QR gerado no cliente (SVG, sem pedidos externos: o token nunca sai do dispositivo).
 * Fundo branco e margem de 4 módulos fixos, para ler bem também no modo escuro.
 */
export function QrCode({ value, label, className }: QrCodeProps) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const count = qr.getModuleCount()
    let d = ''
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`
      }
    }
    return { size: count + 8, path: d }
  }, [value])

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}
