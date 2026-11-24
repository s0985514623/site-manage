'use client'

import { useEffect, useRef, useState, useTransition } from 'react'

import { Button, FormError } from './ui'
import { addUpdateAction, deleteUpdateAction } from '@/server/actions/updates'
import { emptyState } from '@/server/actions/helpers'

type Target = { projectId: string } | { siteId: string }

const MAX_IMAGES = 10
/** 長邊超過這個尺寸，或檔案超過 1.5MB 才壓縮；截圖通常不會被動到 */
const MAX_EDGE = 1920
const SHRINK_OVER_BYTES = 1.5 * 1024 * 1024

/**
 * 手機照片動輒 3–5MB，一則訊息帶幾張就會超過上傳上限。
 * 送出前在瀏覽器縮到長邊 1920px 的 JPEG，畫質對進度紀錄綽綽有餘。
 * 瀏覽器解不開的格式（例如桌機 Chrome 的 HEIC）原檔送出，由伺服器回錯誤訊息。
 */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  const longest = Math.max(bitmap.width, bitmap.height)
  if (longest <= MAX_EDGE && file.size <= SHRINK_OVER_BYTES) {
    bitmap.close()
    return file
  }
  const scale = Math.min(1, MAX_EDGE / longest)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) return file
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], name, { type: 'image/jpeg' })
}

type Picked = { file: File; url: string }

/** 對話串底部的輸入框：文字＋圖片（選檔、貼上），Ctrl/⌘ + Enter 送出 */
export function UpdateComposer({ target }: { target: Target }) {
  const [body, setBody] = useState('')
  const [picked, setPicked] = useState<Picked[]>([])
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()
  const fileInput = useRef<HTMLInputElement>(null)

  // 預覽用的 object URL 在移除或卸載時釋放
  const urls = useRef<string[]>([])
  useEffect(() => {
    urls.current = picked.map((p) => p.url)
  }, [picked])
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  function addFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (images.length === 0) return
    setError(undefined)
    setPicked((prev) => {
      const room = MAX_IMAGES - prev.length
      if (images.length > room) setError(`一則訊息最多 ${MAX_IMAGES} 張圖片`)
      return [...prev, ...images.slice(0, Math.max(0, room)).map((file) => ({ file, url: URL.createObjectURL(file) }))]
    })
  }

  function remove(index: number) {
    setPicked((prev) => {
      URL.revokeObjectURL(prev[index].url)
      return prev.filter((_, i) => i !== index)
    })
  }

  function submit() {
    if (pending) return
    if (!body.trim() && picked.length === 0) {
      setError('請輸入訊息或附上圖片')
      return
    }
    setError(undefined)
    startTransition(async () => {
      const fd = new FormData()
      if ('projectId' in target) fd.set('projectId', target.projectId)
      else fd.set('siteId', target.siteId)
      fd.set('body', body)
      for (const file of await Promise.all(picked.map((p) => shrink(p.file)))) {
        fd.append('images', file)
      }
      const result = await addUpdateAction(emptyState, fd)
      if (!result.ok) {
        setError(result.error ?? '送出失敗')
        return
      }
      picked.forEach((p) => URL.revokeObjectURL(p.url))
      setPicked([])
      setBody('')
    })
  }

  return (
    <div
      className="space-y-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        addFiles([...e.dataTransfer.files])
      }}
    >
      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {picked.map((p, i) => (
            <li key={p.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- 本機預覽的 blob URL */}
              <img src={p.url} alt={p.file.name} className="size-16 rounded-md border border-border object-cover" />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`移除 ${p.file.name}`}
                className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-xs text-background"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onPaste={(e) => {
          const files = [...e.clipboardData.files]
          if (files.length > 0) {
            e.preventDefault()
            addFiles(files)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            submit()
          }
        }}
        rows={3}
        maxLength={5000}
        placeholder="輸入近況…（可直接貼上或拖曳圖片，Ctrl + Enter 送出）"
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <FormError message={error} />
      <div className="flex items-center justify-between gap-3">
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
            附加圖片{picked.length > 0 ? `（${picked.length}）` : ''}
          </Button>
        </div>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? '送出中…' : '送出'}
        </Button>
      </div>
    </div>
  )
}

/** 刪除一則近況：先按「刪除」再按「確定」，不用瀏覽器原生對話框 */
export function DeleteUpdateButton({ id, target }: { id: string; target: Target }) {
  const [armed, setArmed] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()

  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)} className="text-xs text-muted hover:text-overdue">
        刪除
      </button>
    )
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      {error && <span className="text-overdue">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const fd = new FormData()
            fd.set('id', id)
            if ('projectId' in target) fd.set('projectId', target.projectId)
            else fd.set('siteId', target.siteId)
            const r = await deleteUpdateAction(emptyState, fd)
            if (!r.ok) setError(r.error ?? '刪除失敗')
          })
        }
        className="font-medium text-overdue hover:underline"
      >
        {pending ? '刪除中…' : '確定刪除'}
      </button>
      <button type="button" onClick={() => setArmed(false)} className="text-muted hover:text-foreground">
        取消
      </button>
    </span>
  )
}

/** 對話串捲到最底（最新一則），新增訊息後也會跟著捲 */
export function ScrollToBottom({ count, children }: { count: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count])
  return (
    <div ref={ref} className="max-h-[36rem] overflow-y-auto">
      {children}
    </div>
  )
}
