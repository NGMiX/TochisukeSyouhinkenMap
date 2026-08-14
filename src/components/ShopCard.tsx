import { AREA_LABELS, CATEGORY_LABELS, type Shop } from '@/lib/shop'

/**
 * 住所から Google マップを開くリンク。
 *
 * 座標が無くても住所だけで開ける。スマートフォンでは Google マップアプリが
 * 起動し、そのまま経路案内に繋がるため、地図タブとは別に常に用意しておく。
 */
function mapsUrl(shop: Shop): string {
  const query =
    shop.lat !== null && shop.lng !== null
      ? `${shop.lat},${shop.lng}`
      : `${shop.name} ${shop.address}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

export function ShopCard({ shop }: { shop: Shop }) {
  return (
    <li className="card">
      <h2>
        {shop.name}
        {shop.kana !== '' && <span className="kana">{shop.kana}</span>}
      </h2>

      <address>{shop.address}</address>

      <div className="card-meta">
        {/* 券の色は絞り込み条件であると同時に、店頭ののぼり旗と対応する手がかりでもある */}
        {shop.isLarge ? (
          <span className="badge badge-ticket badge-blue">青色券</span>
        ) : (
          <>
            <span className="badge badge-ticket badge-yellow">黄色券</span>
            <span className="badge badge-ticket badge-blue">青色券</span>
          </>
        )}
        <span className="badge">{CATEGORY_LABELS[shop.category]}</span>
        <span className="badge">{AREA_LABELS[shop.area]}</span>
      </div>

      <div className="card-actions">
        {/* 電話番号が非公開（Excel 上は 000-0000-0000）の店では発信させない */}
        {shop.tel !== null && (
          <a className="action" href={`tel:${shop.tel}`}>
            {shop.tel}
          </a>
        )}
        <a className="action" href={mapsUrl(shop)} target="_blank" rel="noreferrer">
          地図で開く
        </a>
      </div>
    </li>
  )
}
