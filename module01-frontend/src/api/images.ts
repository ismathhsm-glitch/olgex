import { api } from './client'
import type { Envelope } from './types'

type CachedImage = {
  objectUrl?: string
  request: Promise<string>
  references: number
  stale: boolean
}

const imageCache = new Map<string, CachedImage>()

export async function acquireImage(path: string, version: string): Promise<{ objectUrl: string; release: () => void }> {
  const key = `${path}:${version}`
  let cached = imageCache.get(key)
  if (!cached) {
    const entry: CachedImage = {
      references: 0,
      stale: false,
      request: Promise.resolve(''),
    }
    entry.request = api.get<Blob>(path, { responseType: 'blob' })
      .then(({ data }) => {
        entry.objectUrl = URL.createObjectURL(data)
        if (entry.stale && entry.references === 0) URL.revokeObjectURL(entry.objectUrl)
        return entry.objectUrl
      })
      .catch((error: unknown) => {
        imageCache.delete(key)
        throw error
      })
    cached = entry
    imageCache.set(key, cached)
  }
  cached.references += 1
  const entry = cached
  try {
    const objectUrl = await entry.request
    let released = false
    return {
      objectUrl,
      release: () => {
        if (released) return
        released = true
        entry.references -= 1
        if (entry.references === 0 && entry.stale && entry.objectUrl) {
          URL.revokeObjectURL(entry.objectUrl)
        }
      },
    }
  } catch (error) {
    entry.references -= 1
    throw error
  }
}

function invalidateImages(prefix: string) {
  for (const [key, entry] of imageCache) {
    if (!key.startsWith(prefix)) continue
    imageCache.delete(key)
    entry.stale = true
    if (entry.references === 0 && entry.objectUrl) URL.revokeObjectURL(entry.objectUrl)
  }
}

export async function uploadImage(path: string, image: Blob): Promise<string> {
  const form = new FormData()
  form.append('file', image)
  const { data } = await api.put<Envelope<{ avatarVersion?: string; logoVersion?: string }>>(path, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  if (!data.success || !data.data) throw new Error(data.error?.code ?? 'UPLOAD_FAILED')
  const version = data.data.avatarVersion ?? data.data.logoVersion
  if (!version) throw new Error('IMAGE_VERSION_MISSING')
  invalidateImages(path.startsWith('/users/') ? '/users/' : '/organizations/')
  return version
}

export async function removeImage(path: string): Promise<void> {
  const { data } = await api.delete<Envelope<{ status: string }>>(path)
  if (!data.success || !data.data) throw new Error(data.error?.code ?? 'REMOVE_FAILED')
  invalidateImages(path.startsWith('/users/') ? '/users/' : '/organizations/')
}
