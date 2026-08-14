'use client'

import { EMPTY_FILTERS, type Filters, hasActiveFilters, toggle } from '@/lib/filter'
import type { SortOrder } from '@/lib/geo'
import { AREA_LABELS, AREA_ORDER, CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/shop'
import type { PositionState } from '@/lib/use-current-position'

type Props = {
  filters: Filters
  onChange: (filters: Filters) => void
  order: SortOrder
  /** `distance` を渡されたら、親が必要に応じて現在地の取得を始める。 */
  onOrderChange: (order: SortOrder) => void
  positionStatus: PositionState['status']
  /** 業種・地区の折りたたみ。開閉の状態は親が持つ（タブを切り替えても閉じないように）。 */
  detailsOpen: boolean
  onDetailsOpenChange: (open: boolean) => void
}

export function FilterBar({
  filters,
  onChange,
  order,
  onOrderChange,
  positionStatus,
  detailsOpen,
  onDetailsOpenChange,
}: Props) {
  // 折りたたみの中に隠れている条件の数。閉じている間も掛かっていることが分かるように出す。
  const hiddenCount = filters.categories.length + filters.areas.length

  return (
    <>
      <div className="search-row">
        <input
          className="search"
          type="search"
          inputMode="search"
          placeholder="店名・住所で さがす"
          aria-label="店名・住所で さがす"
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
        />
        {/*
          type="search" の標準のクリアボタンは Safari では出ず、Chrome でも小さい。
          指で押せる大きさのものを自前で置く。
        */}
        {filters.query !== '' && (
          <button
            type="button"
            className="search-clear"
            aria-label="検索語を消す"
            onClick={() => onChange({ ...filters, query: '' })}
          >
            ✕
          </button>
        )}
      </div>

      {/*
        1 行目には利用者の関心が強い 2 つだけを置く。
        「手元の券が使えるか」（黄色券保有者には 150 店が対象外）と
        「近所で使えるか」で、業種・地区はその次。
      */}
      <div className="chips chips-primary">
        <button
          type="button"
          className="chip chip-yellow"
          aria-pressed={filters.yellowOnly}
          onClick={() => onChange({ ...filters, yellowOnly: !filters.yellowOnly })}
        >
          黄色券が使えるお店
        </button>

        <button
          type="button"
          className="chip"
          aria-pressed={order === 'distance'}
          // 取得中は二重に要求しない
          disabled={positionStatus === 'locating'}
          onClick={() => onOrderChange(order === 'distance' ? 'default' : 'distance')}
        >
          {positionStatus === 'locating' ? '現在地を確認中…' : '近い順'}
        </button>

        <button
          type="button"
          className="chip chip-details"
          aria-expanded={detailsOpen}
          onClick={() => onDetailsOpenChange(!detailsOpen)}
        >
          業種・地区
          {hiddenCount > 0 && <span className="chip-count">{hiddenCount}</span>}
          <span aria-hidden="true">{detailsOpen ? ' ▲' : ' ▼'}</span>
        </button>
      </div>

      {/*
        業種 9 個・地区 6 個を常に出すと、sticky なヘッダーだけで
        スマホの画面高の半分以上を占める。既定では畳んでおく。
      */}
      {detailsOpen && (
        <div className="filter-details">
          <div className="filter-group">
            <div className="filter-label">業種</div>
            <div className="chips chips-scroll">
              {CATEGORY_ORDER.map((code) => (
                <button
                  key={code}
                  type="button"
                  className="chip"
                  aria-pressed={filters.categories.includes(code)}
                  onClick={() =>
                    onChange({
                      ...filters,
                      categories: toggle(filters.categories, code),
                    })
                  }
                >
                  {CATEGORY_LABELS[code]}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <div className="filter-label">地区</div>
            <div className="chips chips-scroll">
              {AREA_ORDER.map((code) => (
                <button
                  key={code}
                  type="button"
                  className="chip"
                  aria-pressed={filters.areas.includes(code)}
                  onClick={() =>
                    onChange({ ...filters, areas: toggle(filters.areas, code) })
                  }
                >
                  {AREA_LABELS[code]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {hasActiveFilters(filters) && (
        <button
          type="button"
          className="clear-all"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          絞り込みをすべて外す
        </button>
      )}
    </>
  )
}
