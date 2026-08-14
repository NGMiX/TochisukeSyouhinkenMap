import { ShopFinder } from '@/components/ShopFinder'

/**
 * 静的エクスポートのため、このページはビルド時に 1 枚の HTML になる。
 * 加盟店データは実行時にブラウザが `shops.json` を取得する
 * （データ更新時に JSON 1 ファイルの差し替えで済ませるため。詳細は CLAUDE.md）。
 */
export default function Page() {
  return <ShopFinder />
}
