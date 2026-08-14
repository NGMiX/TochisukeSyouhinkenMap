import { matchesQuery } from './normalize'
import { type AreaCode, acceptsYellow, type CategoryCode, type Shop } from './shop'

export type Filters = {
  /** 自由入力。店名・かな・住所・業種を横断して部分一致する。 */
  query: string
  /**
   * 黄色券が使える店だけに絞る。
   * 利用者にとって最も影響の大きい条件（黄色券保有者には 150 店が対象外になる）。
   */
  yellowOnly: boolean
  /** 空配列は「絞り込まない」。選択したものの **いずれか** に当たれば残る。 */
  categories: CategoryCode[]
  /** 空配列は「絞り込まない」。 */
  areas: AreaCode[]
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  yellowOnly: false,
  categories: [],
  areas: [],
}

export function filterShops(shops: Shop[], filters: Filters): Shop[] {
  const categories = new Set<CategoryCode>(filters.categories)
  const areas = new Set<AreaCode>(filters.areas)

  return shops.filter((shop) => {
    if (filters.yellowOnly && !acceptsYellow(shop)) return false
    if (categories.size > 0 && !categories.has(shop.category)) return false
    if (areas.size > 0 && !areas.has(shop.area)) return false
    return matchesQuery(shop.q, filters.query)
  })
}

/** 絞り込みが 1 つでも掛かっているか。「条件をクリア」の表示判定に使う。 */
export function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.yellowOnly ||
    filters.categories.length > 0 ||
    filters.areas.length > 0
  )
}

/** 配列に対する選択のトグル。絞り込み UI から使う。 */
export function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}
