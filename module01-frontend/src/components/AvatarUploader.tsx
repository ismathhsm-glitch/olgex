import Cropper, { type Area } from 'react-easy-crop'
import { Camera, ImagePlus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getApiError } from '../api/errors'
import { Avatar, type AvatarSize } from './Avatar'
import { Button, Dialog } from './ui'

const maxImageBytes = 2 * 1024 * 1024
const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

async function createCroppedJpeg(source: string, area: Area): Promise<Blob> {
  const image = new Image()
  image.src = source
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'))
  })
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) throw new Error('CANVAS_UNAVAILABLE')
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, 256, 256)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('IMAGE_ENCODING_FAILED'))
    }, 'image/jpeg', 0.9)
  })
}

function friendlyImageError(error: unknown): string {
  const parsed = getApiError(error)
  if (parsed.status === 413) return 'That photo is too large. Choose an image no larger than 2 MB.'
  if (parsed.status === 415 || parsed.status === 400) return 'We could not verify that image. Choose a valid JPEG, PNG or WebP photo.'
  if (parsed.code === 'IMAGE_DECODE_FAILED') return 'This image could not be opened. Choose a different photo.'
  return parsed.message
}

export function AvatarUploader({ name, path, version, size = 40, editable, onUpload, onRemove, label }: {
  name: string
  path: string
  version: string | null
  size?: AvatarSize
  editable: boolean
  onUpload: (image: Blob) => Promise<string>
  onRemove: () => Promise<void>
  label: string
}) {
  const [versionOverride, setVersionOverride] = useState<string | null | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const [cropOpen, setCropOpen] = useState(false)
  const [cropSource, setCropSource] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [menuFocusReturn, setMenuFocusReturn] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sourceRef = useRef<string | null>(null)
  const currentVersion = versionOverride === undefined ? version : versionOverride

  useEffect(() => setVersionOverride(undefined), [version])

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    else if (menuFocusReturn) {
      triggerRef.current?.focus()
      setMenuFocusReturn(false)
    }
  }, [menuFocusReturn, menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) {
        setMenuOpen(false)
      }
    }
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        setMenuFocusReturn(true)
      }
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [menuOpen])

  useEffect(() => () => {
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current)
  }, [])

  if (!editable) return <Avatar name={name} path={path} version={version} size={size} alt={label} />

  const closeMenu = () => {
    setMenuOpen(false)
    setMenuFocusReturn(true)
  }

  const selectUpload = () => {
    closeMenu()
    fileInputRef.current?.click()
  }

  const selectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    if (!acceptedImageTypes.has(file.type.toLowerCase())) {
      setError('Choose a JPEG, PNG or WebP image.')
      return
    }
    if (file.size > maxImageBytes) {
      setError('That photo is too large. Choose an image no larger than 2 MB.')
      return
    }
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current)
    const source = URL.createObjectURL(file)
    sourceRef.current = source
    setCropSource(source)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCropOpen(true)
  }

  const closeCrop = (open: boolean) => {
    setCropOpen(open)
    if (!open && sourceRef.current) {
      URL.revokeObjectURL(sourceRef.current)
      sourceRef.current = null
      setCropSource(null)
      setCroppedArea(null)
    }
  }

  const saveCrop = async () => {
    if (!cropSource || !croppedArea) return
    setSaving(true)
    setError('')
    try {
      const jpeg = await createCroppedJpeg(cropSource, croppedArea)
      if (jpeg.size > maxImageBytes) {
        setError('The cropped photo is too large. Choose a smaller image or crop a smaller area.')
        return
      }
      const newVersion = await onUpload(jpeg)
      setVersionOverride(newVersion)
      closeCrop(false)
    } catch (reason) {
      setError(friendlyImageError(reason))
    } finally {
      setSaving(false)
    }
  }

  const removePhoto = async () => {
    closeMenu()
    setError('')
    try {
      await onRemove()
      setVersionOverride(null)
    } catch (reason) {
      setError(friendlyImageError(reason))
    }
  }

  const moveMenuFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const delta = event.key === 'ArrowDown' ? 1 : -1
    items[(index + delta + items.length) % items.length]?.focus()
  }

  return (
    <div className="avatar-uploader">
      <button
        ref={triggerRef}
        type="button"
        className="avatar-upload-trigger"
        aria-label={`Photo options for ${name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Avatar name={name} path={path} version={currentVersion} size={size} alt={label} />
        <span className="avatar-camera-badge" aria-hidden="true"><Camera size={14} /></span>
      </button>
      {menuOpen && <div ref={menuRef} className="avatar-menu" role="menu" aria-label={`${label} options`} onKeyDown={moveMenuFocus}>
        <button type="button" role="menuitem" onClick={selectUpload}><ImagePlus size={16} />Upload photo</button>
        <button type="button" role="menuitem" disabled={!currentVersion} onClick={() => void removePhoto()}><Trash2 size={16} />Remove photo</button>
      </div>}
      <input ref={fileInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Choose a photo for ${name}`} onChange={selectFile} />
      {error && <p className="avatar-upload-error" role="alert">{error}</p>}
      <Dialog open={cropOpen} onOpenChange={closeCrop} title="Crop your photo" description="Move the image and adjust the zoom to choose a square crop.">
        <div className="dialog-body">
          {cropSource && <div className="avatar-cropper">
            <Cropper
              image={cropSource}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, area) => setCroppedArea(area)}
            />
          </div>}
          <div className="field">
            <label htmlFor="avatarZoom">Zoom</label>
            <input id="avatarZoom" type="range" min={1} max={3} step={0.05} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </div>
          <div className="dialog-actions">
            <Button variant="secondary" disabled={saving} onClick={() => closeCrop(false)}>Cancel</Button>
            <Button loading={saving} disabled={!croppedArea} onClick={() => void saveCrop()}>Save photo</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
