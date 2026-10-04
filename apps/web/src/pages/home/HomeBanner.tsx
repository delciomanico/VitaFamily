import { useState } from 'react'
import { ImageIcon } from 'lucide-react'

/**
 * Imagem do banner da Home, fornecida pelo proprietário (com licença).
 * Basta colocar o ficheiro em `public/images/home-banner.jpg`; até lá aparece um marcador neutro.
 */
export const HOME_BANNER_SRC = '/images/home-banner.jpg'

export function HomeBanner() {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div
        className="flex aspect-[16/9] w-full md:aspect-[21/9] items-center justify-center rounded-xl border border-dashed border-border-strong bg-primary-soft text-accent"
        aria-hidden
      >
        <ImageIcon className="size-10" strokeWidth={1.5} />
      </div>
    )
  }

  return (
    <img
      src={HOME_BANNER_SRC}
      alt=""
      onError={() => setFailed(true)}
      className="aspect-[16/9] w-full md:aspect-[21/9] rounded-xl bg-primary-soft object-cover"
    />
  )
}
