import { sql } from '@/db'

export const dynamic = 'force-dynamic'

/**
 * 健康檢查（共用 VPS 規格 SHARED-VPS-SPEC §1）。
 *
 * 使用者：Dockerfile 的 HEALTHCHECK（deploy.sh 靠它判斷成功或回滾）、
 * GitHub Actions 的 public smoke、外部監控主機。
 *
 * 只回 ok / error，不帶任何內部細節：這支不需登入，對公網開放。
 */
export async function GET() {
  try {
    await Promise.race([
      sql`select 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 3000),
      ),
    ])
    return Response.json({ status: 'ok' })
  } catch {
    return Response.json({ status: 'error' }, { status: 503 })
  }
}
