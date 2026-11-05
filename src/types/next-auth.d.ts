import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth/jwt' {
  interface JWT {
    /** 首次 Google 授權時取得，用於行事曆同步 */
    googleRefreshToken?: string
  }
}

declare module 'next-auth' {
  interface Session {
    user: {
      email?: string | null
      name?: string | null
      image?: string | null
    }
  }
}
