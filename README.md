# とち介商品券マップ

栃木県栃木市の「**とち介商品券**」が使える加盟店を、店名・業種・地区・現在地から探せる Web アプリです。

**公開中: https://www.ngmix.com/tochisuke/**

> [!NOTE]
> とち介商品券は 2026 年 10 月末で利用期間を終えました。
> サイトはアプリケーションのデモとして公開を続けています。
> このリポジトリは市の公式のものではありません。

## 特徴

- **スマートフォン向け**。リストが主画面で、地図はタブで切り替え
- **かな・漢字・英字のどれで打っても当たる検索**（NFKC 正規化＋カタカナ→ひらがな。検索ライブラリは使っていない）
- **券種で一発絞り込み** — 黄色券は中小店舗だけで使えるため、「黄色券が使えるお店」をワンタップで切り替えられる
- 業種・地区（旧市町単位）での絞り込み、**現在地から近い順**の並べ替え
- 地図は券種ごとに色分けしたピンとクラスタで表示し、初めてタブを開いたときに遅延ロード
- **サーバー処理なしの静的サイト**。約 700 件の加盟店データは JSON 1 ファイル（gzip 時 33 KB）で配信し、検索・絞り込みはすべてブラウザ内で行う

## 技術構成

| 項目 | 選定 |
| --- | --- |
| フレームワーク | Next.js 15（App Router, `output: 'export'`）+ React 19 + TypeScript |
| 地図 | Google Maps JavaScript API（Advanced Markers + MarkerClusterer） |
| 座標の取得 | Google Geocoding API / Places API (New)。取り込み時に 1 回だけ実行し、結果をコミット |
| ランタイム・パッケージ管理 | Bun |
| Lint / Format | Biome |
| ホスティング | 共用レンタルサーバ（静的ファイルのみ） |

## データの流れ

市が公開している加盟店リスト（Excel）を取り込み、人が手直しする CSV を経て JSON にします。

```
data/raw/*.xlsx      市が公開した原本。加工しない
   │ bun run import:excel
   ▼
data/shops.csv       正本。手直しはここで行う
   │ bun run import:csv / bun run geocode
   ▼
public/shops.json    配信されるデータ（ブラウザが fetch する）
   │ bun run build
   ▼
out/                 静的ファイル一式
```

データだけを更新するときは、再ビルドせずに `shops.json` を差し替えれば反映されます。

## 動かし方

[Bun](https://bun.sh/) が必要です。

```bash
bun install
cp .env.local.example .env.local   # 地図を表示するなら API キーを設定する
bun dev                            # http://localhost:3000/tochisuke/
```

API キーが無くても、リスト・検索・絞り込みは動きます（地図タブだけが使えません）。
キーの種類と制限のかけ方は [.env.local.example](.env.local.example) を参照してください。

### コマンド

```bash
bun dev                  # 開発サーバー（/tochisuke/ 配下で動く）
bun run build            # 静的エクスポート（out/ を生成）
bun run preview          # out/ を本番と同じ /tochisuke/ 配下で配信（http://localhost:4000/tochisuke/）
bun test                 # テスト
bun run lint             # Biome

bun run import:excel -- data/raw/<ファイル>.xlsx   # 市の Excel → data/shops.csv → JSON
bun run import:csv       # data/shops.csv → public/shops.json（API は叩かない）
bun run geocode          # 住所・店名 → 緯度経度（要 GEOCODING_API_KEY。取得済みは再問い合わせしない）
```

## ディレクトリ

```
src/
  lib/          正規化・検索・絞り込み・距離などのロジック（テスト付き）
  components/   画面（ShopFinder / FilterBar / ShopCard / map/）
  app/          Next.js App Router
scripts/        Excel・CSV の取り込み、ジオコーディング、プレビュー用サーバー
data/           取り込みの入力と、座標のキャッシュ（配信されない）
public/         shops.json と OG 画像（配信される）
doc/            運用者向けの文書
```

## 文書

| 文書 | 内容 |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | 設計の理由と制約（実データの癖、地図の寄せ方、Google Maps の費用など） |
| [doc/運用手順.md](doc/運用手順.md) | 加盟店リストの更新、確認列の使い方、公開の手順 |
| [doc/動作環境.md](doc/動作環境.md) | 利用者の端末に必要な条件、症状からの切り分け |
| [doc/サーバー要件.md](doc/サーバー要件.md) | 置き場所に必要な条件、別のサーバーへ移すときの手順 |

## データについて

- 加盟店の情報は、栃木市が公開している「とち介商品券取扱加盟店」リストをもとにしています。
  `data/raw/` には市が公開したファイルをそのまま置いています。
- 緯度経度は Google の API で求めたもので、実際の店舗の位置と異なる場合があります。
- 最新・正確な情報は栃木市の発表を確認してください。

## 利用について

このリポジトリのソースコードは、閲覧・参考にしていただいて構いません。
ただし、複製・改変・他の地域での運用などに利用する場合は、事前にご相談ください（[LICENSE](LICENSE)）。
`data/raw/` のファイルは栃木市の公開資料であり、NPS Software の著作物ではありません。
