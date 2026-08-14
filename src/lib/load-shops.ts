import { buildSearchIndex, shopKey } from './normalize'
import { CATEGORY_LABELS, type Shop, type ShopRecord, type ShopsFile } from './shop'

/**
 * `shops.json` の 1 レコードから実行時の `Shop` を作る。
 *
 * 同一性キーと検索インデックスはここで導出する。取り込み側と同じ
 * `src/lib/normalize.ts` を通すため、両者がずれることはない。
 */
export function toShop(record: ShopRecord): Shop {
  return {
    ...record,
    id: shopKey(record.name, record.address),
    q: buildSearchIndex({
      name: record.name,
      kana: record.kana,
      address: record.address,
      categoryLabel: CATEGORY_LABELS[record.category],
    }),
  }
}

/**
 * 公開ディレクトリの `shops.json` を取得する。
 *
 * **`fetch('/shops.json')` と書いてはいけない。** `basePath` が自動で前置されるのは
 * `next/link` や `next/image` などのコンポーネントだけで、素の `fetch` には効かない。
 * 本番では `/tochisuke/` 配下に置くため、前置しないと 404 になる。
 * この不具合は `bun dev`（ルート直下で配信）では再現せず、本番でだけ壊れる。
 */
export async function loadShops(): Promise<{
  shops: Shop[]
  sourceLabel: string
}> {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
  const response = await fetch(`${basePath}/shops.json`)
  if (!response.ok) {
    throw new Error(`shops.json を取得できない (HTTP ${response.status})`)
  }
  const file = (await response.json()) as ShopsFile
  return {
    shops: file.shops.map(toShop),
    sourceLabel: file.sourceLabel,
  }
}
