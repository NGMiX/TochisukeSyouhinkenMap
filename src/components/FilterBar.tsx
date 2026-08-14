'use client'

import { type Filters, toggle } from '@/lib/filter'
import { AREA_LABELS, AREA_ORDER, CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/shop'

type Props = {
  filters: Filters
  onChange: (filters: Filters) => void
}

export function FilterBar({ filters, onChange }: Props) {
  return (
    <>
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
        黄色券の切り替えは他の条件と並べず単独で置く。
        「手元の券が使えるか」が利用者の第一の関心であり、
        黄色券保有者にとっては 150 店が対象外になる最重要の条件のため。
      */}
      <div className="chips">
        <button
          type="button"
          className="chip chip-yellow"
          aria-pressed={filters.yellowOnly}
          onClick={() => onChange({ ...filters, yellowOnly: !filters.yellowOnly })}
        >
          黄色券が使えるお店だけ
        </button>
      </div>

      <div className="filter-group">
        <div className="filter-label">業種</div>
        <div className="chips">
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
        <div className="chips">
          {AREA_ORDER.map((code) => (
            <button
              key={code}
              type="button"
              className="chip"
              aria-pressed={filters.areas.includes(code)}
              onClick={() => onChange({ ...filters, areas: toggle(filters.areas, code) })}
            >
              {AREA_LABELS[code]}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
