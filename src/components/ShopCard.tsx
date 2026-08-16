import { formatDistance } from '@/lib/geo'
import { AREA_LABELS, CATEGORY_LABELS, type Shop } from '@/lib/shop'

/**
 * Google マップを開くリンク。
 *
 * **座標ではなく店名と住所を渡す。** 座標を渡すと Google マップは「その地点」として
 * 開き、店名ではなく緯度経度が見出しに出る。店名で開けば店の情報（営業時間・写真・
 * 経路）にそのまま繋がる。住所を添えるのは、同じ屋号の別の店に飛ばないようにするため。
 *
 * スマートフォンでは Google マップアプリが起動し、そのまま経路案内に繋がるので、
 * アプリ内の地図タブとは別に常に用意しておく。
 */
function mapsUrl(shop: Shop): string {
  const query = `${shop.name} ${shop.address}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

type Props = {
  shop: Shop
  /** 現在地からの距離（メートル）。現在地が無いか店舗の座標が無ければ null。 */
  distance: number | null
}

export function ShopCard({ shop, distance }: Props) {
  return (
    <li className="card">
      <h2>
        {shop.name}
        {shop.kana !== '' && <span className="kana">{shop.kana}</span>}
      </h2>

      <div className="card-address">
        <address>{shop.address}</address>
        {distance !== null && (
          <span className="distance">{formatDistance(distance)}</span>
        )}
      </div>

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
