import { useEffect, useState } from 'react'
import { acquireImage } from '../api/images'

export type AvatarSize = 24 | 32 | 40 | 96

export function Avatar({ name, path, version, imageData, size = 32, alt }: {
  name: string
  path?: string | null
  version?: string | null
  imageData?: string | null
  size?: AvatarSize
  alt?: string
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase() || '?'

  useEffect(() => {
    let active = true
    let release: (() => void) | undefined
    setImageUrl(null)
    setUnavailable(false)
    if (path && version) {
      void acquireImage(path, version).then((image) => {
        release = image.release
        if (active) setImageUrl(image.objectUrl)
        else image.release()
      }).catch(() => {
        if (active) {
          setImageUrl(null)
          setUnavailable(true)
        }
      })
    }
    return () => {
      active = false
      release?.()
    }
  }, [path, version])

  return (
    <span className={`avatar avatar-size-${size}`} role="img" aria-label={unavailable ? `${alt ?? `Photo of ${name}`} unavailable; showing initials` : alt ?? `Photo of ${name}`}>
      {imageData || imageUrl ? <img src={imageData ?? imageUrl ?? undefined} alt="" /> : <span aria-hidden="true">{initials}</span>}
    </span>
  )
}
