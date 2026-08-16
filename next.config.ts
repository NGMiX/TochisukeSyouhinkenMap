import type { NextConfig } from 'next'

/**
 * 公開先は https://www.ngmix.com/tochisuke/ 固定。
 *
 * `basePath` と `NEXT_PUBLIC_BASE_PATH` の二重管理を避けるため、**定義はここ 1 箇所**にして
 * クライアント向けの環境変数も同じ値から配る。素の `fetch` には `basePath` が
 * 自動で前置されないため、クライアント側は `NEXT_PUBLIC_BASE_PATH` を使って自前で前置する。
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/tochisuke'

const nextConfig: NextConfig = {
  // 静的出力。さくらのレンタルサーバは常駐プロセスを許さないため必須。
  output: 'export',

  // サブディレクトリ公開のため必須。無いと CSS/JS の参照先がずれてページが真っ白になる。
  // 開発サーバーでも同じ値を使う。本番だけ /tochisuke/ 配下になる構成にすると、
  // basePath 絡みの不具合が本番でしか出なくなるため。
  basePath,

  // out/xxx/index.html の形で出力させる。無いと out/xxx.html になり、
  // Apache が拡張子なし URL を 404 にする。
  trailingSlash: true,

  // 画像最適化はサーバー機能なので静的出力では動かない。
  images: { unoptimized: true },

  env: { NEXT_PUBLIC_BASE_PATH: basePath },

  /**
   * 開発サーバーを LAN の IP で開くときに許可するホスト（**開発時のみ効く設定**）。
   *
   * スマートフォン実機で確認したいことがある。指定が無いと Next.js が
   * `_next/*` への別オリジンからの要求を警告し、将来の版では拒否する。
   * 本番の静的出力には一切影響しない。
   */
  allowedDevOrigins: ['192.168.1.101'],
}

export default nextConfig
