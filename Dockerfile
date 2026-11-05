# syntax=docker/dockerfile:1

# ==============================================================================
# 為什麼在 Docker 裡 build，而不是在本機 build 完把產物丟上去
#
# 本機是 Windows，VPS 是 Linux。npm 會依作業系統裝不同的原生套件，
# 本機的 node_modules 裡現在躺著 @next/swc-win32-x64-msvc、
# @tailwindcss/oxide-win32-x64-msvc、lightningcss-win32-x64-msvc、
# @unrs/resolver-binding-win32-x64-msvc 與 @img/sharp-win32-x64。
#
# 這個專案的執行時相依剛好全是純 JS（postgres.js、@react-pdf/renderer、
# xlsx、whoiser），而且全專案沒有一處用 next/image，所以 sharp 永遠不會
# 被載入 —— 也就是說「大概」跑得起來。但部署不該建立在「大概」上。
# 在這裡 build，host 是什麼系統就完全不重要了。
# ==============================================================================

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
# Next.js 的原生套件是 glibc 編的，在 Alpine 的 musl 環境需要這層相容層
RUN apk add --no-cache libc6-compat
WORKDIR /app


# ------------------------------------------------------------------ 相依套件 --
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci


# --------------------------------------------------------------------- 建置 --
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 建置階段的假環境變數。
#
# src/lib/env.ts 在模組載入的那一刻就用 zod 驗證並拋錯，而 next build 的
# 「Collecting page data」會 import 每一支 route，所以少了這些值會直接失敗。
#
# 填假值是安全的，有兩道保證：
#   1. next build 的輸出顯示所有頁面都是 ƒ (Dynamic)，沒有任何一頁會把
#      環境變數 prerender 進產物
#   2. env.ts 最上面的 import 'server-only' 擋著，不可能被打包進瀏覽器
# 真正的值由 docker-compose 在「執行時」注入。
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    APP_URL="http://localhost:3000" \
    AUTH_SECRET="build-time-placeholder-not-a-real-secret" \
    ENCRYPTION_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
    CRON_SECRET="build-time-placeholder-not-a-real-secret" \
    NEXT_TELEMETRY_DISABLED=1

# src/app/layout.tsx 用 next/font/google 載 Noto Sans TC，字型是在這一步
# 從 fonts.googleapis.com 抓下來內嵌的 —— 這個階段必須連得上外網
RUN npm run build

# standalone 預設不含 public/ 與 .next/static，必須手動搬過去。
#
# 這不只是「靜態檔會 404」的問題：src/lib/pdf/QuoteDocument.tsx 與
# src/lib/pdf/wrap.ts 是在執行時用 fs 從 process.cwd()/public/fonts 讀
# 中文字型的。少了這一步，產 PDF 不會報任何錯，只會讓客戶打開附件時
# 看到一整片空白方框 —— 而那時信已經寄出去了。
RUN cp -r public .next/standalone/ \
 && cp -r .next/static .next/standalone/.next/

# scripts/migrate.mjs 走 drizzle-orm/postgres-js/migrator，但那支子模組
# 沒有被應用程式 import 過，所以不在 standalone 的相依追蹤結果裡。
# 把這兩個套件完整覆蓋進去（合計約 16 MB），換掉「為了跑 migration
# 另外做一個含 devDependencies 的映像」那整套麻煩。
RUN cp -r node_modules/drizzle-orm .next/standalone/node_modules/ \
 && cp -r node_modules/postgres .next/standalone/node_modules/

# 第一次部署時 src/db/migrations 還不存在，先建出空目錄讓下面的 COPY
# 不會失敗；真的沒有 .sql 時由 migrate.mjs 給出清楚的錯誤訊息
RUN mkdir -p src/db/migrations


# --------------------------------------------------------------------- 執行 --
FROM base AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Taipei

# 不用 root 跑。這個服務會把客戶回簽的 PDF 寫進資料庫、手上有解密金鑰，
# 少一層權限就少一種被放大的可能
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/src/db/migrations ./src/db/migrations

USER nextjs
EXPOSE 3000

# standalone 產出的 server.js 會讀 PORT / HOSTNAME
CMD ["node", "server.js"]
