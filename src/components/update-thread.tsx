import { Card } from './ui'
import { DeleteUpdateButton, ScrollToBottom, UpdateComposer } from './update-composer'
import { listUpdates, type UpdateTarget } from '@/server/updates'

const TZ = 'Asia/Taipei'

function dayKey(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: TZ }) // YYYY-MM-DD
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString('zh-TW', { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString('zh-TW', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * 近況對話串：依時間由舊到新，最新在最下面，底部是輸入框。
 * 專案頁與網站頁共用。
 */
export async function UpdateThread({ target, description }: { target: UpdateTarget; description?: string }) {
  const items = await listUpdates(target)

  return (
    <Card
      title="近況"
      description={description ?? '依時間記錄進度、溝通內容與截圖，像對話一樣往下加'}
    >
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">還沒有任何近況，從下面輸入第一則。</p>
      ) : (
        <ScrollToBottom count={items.length}>
          <ol className="space-y-3 px-5 py-4">
            {items.map((u, i) => {
              const showDay = i === 0 || dayKey(items[i - 1].createdAt) !== dayKey(u.createdAt)
              return (
                <li key={u.id}>
                  {showDay && (
                    <div className="my-3 flex items-center gap-3 text-xs text-muted">
                      <span className="h-px flex-1 bg-border" />
                      {dayLabel(u.createdAt)}
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  )}
                  <div className="group flex items-end gap-2">
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface-muted px-4 py-2.5">
                      {u.body && <p className="whitespace-pre-wrap break-words text-sm">{u.body}</p>}
                      {u.images.length > 0 && (
                        <div className={`flex flex-wrap gap-2 ${u.body ? 'mt-2' : ''}`}>
                          {u.images.map((img) => (
                            <a
                              key={img.id}
                              href={`/api/update-images/${img.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={img.filename}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element -- 需登入的 API 圖片，不經 next/image 最佳化 */}
                              <img
                                src={`/api/update-images/${img.id}`}
                                alt={img.filename}
                                loading="lazy"
                                className="size-32 rounded-lg border border-border object-cover hover:opacity-90"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-start gap-1 pb-0.5">
                      <span className="tabular text-xs text-muted">{timeLabel(u.createdAt)}</span>
                      <span className="transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                        <DeleteUpdateButton id={u.id} target={target} />
                      </span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </ScrollToBottom>
      )}
      <div className="border-t border-border p-5">
        <UpdateComposer target={target} />
      </div>
    </Card>
  )
}
