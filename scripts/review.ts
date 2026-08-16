/**
 * CSV の「確認」「確認事項」列の決め方。
 *
 * 目的は「人が見なければ判断できない行」を毎回同じ規則で洗い出すこと。
 * 機械が確信を持てないものだけを挙げ、**それ以外は黙っている**。
 * 全件に印が付くと、印そのものが読み飛ばされる。
 *
 * 役割:
 * - 機械が `確認事項` を毎回書き直し、中身があれば `要確認` を立てる。
 * - 人が見て問題なしと判断したら `済` と書く。
 * - **`済` は「その時点の確認事項を見て判断した」という意味**。状況が変われば `要確認` に戻す。
 *   戻さないと、住所を直して座標がずれた行が `済` のまま埋もれる。
 *
 * 人が自分で `要確認` と書いた行（機械が挙げた理由が無い行）は、機械が消さない。
 */

export const CHECK_TODO = '要確認'
export const CHECK_DONE = '済'

/**
 * その店を配信しない印。`public/shops.json` に出さないので、アプリからは消える。
 *
 * 閉店した、実体が無い、といった「載せるべきでない店」に人が付ける。
 * **行は消さない。** 消すと、なぜ載せていないのかの記録（メモ）ごと失われ、
 * 次に Excel を取り込んだときに新規店として復活してしまう。
 *
 * この行は機械が素通りする（座標も引かないし、確認事項も立てない）。
 */
export const CHECK_HIDDEN = '非表示'

/** その行を配信しないか。 */
export function isHidden(check: string): boolean {
  return check.trim() === CHECK_HIDDEN
}

/** 確認事項の区切り。1 行に複数並ぶことがある。 */
export const ISSUE_SEPARATOR = ' / '

/**
 * `済` の後に状況が変わったことを示す印。
 *
 * **標準の確認事項とは別に扱う**（これを「前回の確認事項」に数えると、
 * 人が `済` にした次の実行でまた変化と見なされ、いつまでも収まらない）。
 */
export const CHANGED_MARK = '前回の確認後に内容が変わった'

export function parseIssues(value: string): string[] {
  return value
    .split(ISSUE_SEPARATOR)
    .map((issue) => issue.trim())
    .filter((issue) => issue !== '' && issue !== CHANGED_MARK)
}

function sameIssues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, i) => value === right[i])
}

export type ReviewInput = {
  /** CSV に入っていた「確認」列 */
  storedCheck: string
  /** CSV に入っていた「確認事項」列 */
  storedIssues: string
  /** 今回の実行で挙がった確認事項 */
  issues: string[]
  /** 前回の座標から変わったか（住所を直した等） */
  coordChanged: boolean
}

export function updateReview(input: ReviewInput): { check: string; issues: string } {
  const stored = parseIssues(input.storedIssues)
  const check = input.storedCheck.trim()
  const join = (issues: string[]) => issues.join(ISSUE_SEPARATOR)

  // 非表示の行は配信しないので、確認することが無い。人が書いた記録をそのまま残す。
  if (check === CHECK_HIDDEN) {
    return { check: CHECK_HIDDEN, issues: input.storedIssues }
  }

  if (check === CHECK_DONE) {
    // 済 の行は、前回見たときと同じ状況である限りそのまま。
    if (sameIssues(stored, input.issues) && !input.coordChanged) {
      return { check: CHECK_DONE, issues: join(input.issues) }
    }
    return { check: CHECK_TODO, issues: join([...input.issues, CHANGED_MARK]) }
  }

  if (check === CHECK_TODO) {
    // 機械が立てた 要確認 は、理由が消えたら下ろす。
    // 一方、理由が無いのに人が付けた 要確認 は人の意思なので残す。
    if (input.issues.length === 0 && stored.length > 0) {
      return { check: '', issues: '' }
    }
    return { check: CHECK_TODO, issues: join(input.issues) }
  }

  if (check !== '') {
    // 人が独自の言葉を書いた行。値には触らず、確認事項だけ更新する。
    return { check, issues: join(input.issues) }
  }

  return {
    check: input.issues.length > 0 ? CHECK_TODO : '',
    issues: join(input.issues),
  }
}
