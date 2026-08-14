/** 券の色。のぼり旗の色でもあり、店頭で実物を見分ける手がかりになる。 */
export type TicketColor = 'yellow' | 'blue'

/** 業種コード。Excel の `F` 列の `A.` 〜 `I.` に対応する。 */
export type CategoryCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I'

/**
 * 地区。栃木市は 2010 年前後の合併で旧 5 町を含むため、
 * 町名 111 種をそのまま出さず旧市町単位にまとめる。
 */
export type AreaCode = 'tochigi' | 'ohira' | 'fujioka' | 'tsuga' | 'nishikata' | 'iwafune'

/**
 * `shops.json` に入る形。
 *
 * **導出できる値は持たない。** 同一性キーと検索インデックスは name/kana/address から
 * 再生成できるため、ファイルには含めず読み込み時に作る（`toShop`）。
 * 両方を持たせると転送量が gzip で約 2 倍（24KB → 46KB）になる一方、
 * 導出は 655 件で 3ms 程度でしかない。モバイル主体なので転送量を優先する。
 */
export type ShopRecord = {
  /** 表示用の屋号（改行・余分な空白は畳んだもの、それ以外は原文のまま） */
  name: string
  /** フリガナ（全角カタカナ、改行は畳む） */
  kana: string
  /** 表示用の住所（原文の表記を保つ） */
  address: string
  /** 電話番号。非公開（Excel 上は 000-0000-0000）の場合は null */
  tel: string | null
  category: CategoryCode
  area: AreaCode
  /** 大型店舗かどうか。true なら青色券のみ、false なら黄色・青色の両方が使える */
  isLarge: boolean
  /** 緯度経度。ジオコーディング未解決の店は null（リストには出すが地図には出さない） */
  lat: number | null
  lng: number | null
}

/** 実行時に扱う形。`ShopRecord` に導出値を足したもの。 */
export type Shop = ShopRecord & {
  /** 屋号＋住所から作る安定キー。URL にも使う。Excel の No. は使わない。 */
  id: string
  /** 検索用インデックス。正規化済みの店名・かな・住所・業種を連結したもの */
  q: string
}

export type ShopsFile = {
  /** 元となった Excel の版（例: "R8.7.31時点"） */
  sourceLabel: string
  /** 取り込みを実行した日付 (YYYY-MM-DD) */
  importedAt: string
  shops: ShopRecord[]
}

export const CATEGORY_LABELS: Record<CategoryCode, string> = {
  A: 'スーパー・コンビニ',
  // 原文ママ。正しくは「ドラッグ」だが、提供データの表記に合わせる。
  // 検索は normalize 側で両表記に当たるようにする。
  B: 'ドラックストア・薬局',
  C: '小売業',
  D: '卸売業',
  E: '飲食業',
  F: 'サービス',
  G: '製造業',
  H: '建設業',
  I: '運輸業',
}

export const AREA_LABELS: Record<AreaCode, string> = {
  tochigi: '栃木地区',
  ohira: '大平地区',
  fujioka: '藤岡地区',
  tsuga: '都賀地区',
  nishikata: '西方地区',
  iwafune: '岩舟地区',
}

/** 表示順。合併前からの市域を先頭に、以降は Excel の出現順に近い並び。 */
export const AREA_ORDER: AreaCode[] = [
  'tochigi',
  'ohira',
  'fujioka',
  'tsuga',
  'nishikata',
  'iwafune',
]

export const CATEGORY_ORDER: CategoryCode[] = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
]

/** 店で使える券の色。大型店舗は青のみ、中小店舗は黄・青の両方。 */
export function usableTickets(shop: Pick<Shop, 'isLarge'>): TicketColor[] {
  return shop.isLarge ? ['blue'] : ['yellow', 'blue']
}

/** 黄色券が使えるか。利用者にとって最も影響の大きい区別。 */
export function acceptsYellow(shop: Pick<Shop, 'isLarge'>): boolean {
  return !shop.isLarge
}
