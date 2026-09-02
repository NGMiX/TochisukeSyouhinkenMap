import type { MetadataRoute } from 'next'

/**
 * サイトマップ。**リンク以外の発見経路**を Google に用意するために置く。
 *
 * 経緯: このページはサイト内のどこからもリンクされていない時期があり、
 * 「とち介商品券 どこで使える」で出ていたのが**インデックスから落ちた**。
 * トップページにリンクを足して戻ったが、リンク 1 本に依存する状態は同じなので、
 * 発見経路をもう 1 本増やす。
 *
 * **ページは 1 枚だけ**（クライアント側でルーティングしないため）。
 * `lastModified` は加盟店データの更新日を使いたいところだが、ビルド時刻にすると
 * 内容が変わっていなくても毎回変わってしまうので入れない。
 *
 * 出力先は `out/sitemap.xml` で、配信 URL は `https://www.ngmix.com/tochisuke/sitemap.xml`。
 * **サイト直下の `robots.txt` に `Sitemap:` 行を足すか、Search Console で送信すること**
 * （robots.txt はドメイン直下のものしか読まれないので、このリポジトリからは置けない）。
 */
/**
 * **静的エクスポートではこの宣言が必須。** 無いとビルドが
 * `export const dynamic = "force-static" ... not configured` で落ちる。
 */
export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://www.ngmix.com/tochisuke/',
      changeFrequency: 'weekly',
      priority: 1,
    },
  ]
}
