import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'とち介商品券 加盟店さがし',
  description:
    '栃木市のとち介商品券が使えるお店を、店名・住所・業種から探せます。黄色券が使えるお店だけに絞り込めます。',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
