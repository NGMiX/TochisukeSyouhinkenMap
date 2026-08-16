import { describe, expect, test } from 'bun:test'
import {
  CHANGED_MARK,
  CHECK_DONE,
  CHECK_HIDDEN,
  CHECK_TODO,
  isHidden,
  parseIssues,
  updateReview,
} from './review'

function review(overrides: Partial<Parameters<typeof updateReview>[0]> = {}) {
  return updateReview({
    storedCheck: '',
    storedIssues: '',
    issues: [],
    coordChanged: false,
    ...overrides,
  })
}

describe('parseIssues', () => {
  test('区切って読む', () => {
    expect(parseIssues('店名で照合した座標 / 座標が無い（地図に出ない）')).toEqual([
      '店名で照合した座標',
      '座標が無い（地図に出ない）',
    ])
  })

  test('変化の印は確認事項に数えない（数えると済にした次の回でまた戻ってしまう）', () => {
    expect(parseIssues(`店名で照合した座標 / ${CHANGED_MARK}`)).toEqual([
      '店名で照合した座標',
    ])
  })

  test('空欄は空', () => {
    expect(parseIssues('')).toEqual([])
  })
})

describe('updateReview', () => {
  test('確認事項があれば要確認を立てる', () => {
    expect(review({ issues: ['座標が無い（地図に出ない）'] })).toEqual({
      check: CHECK_TODO,
      issues: '座標が無い（地図に出ない）',
    })
  })

  test('確認事項が無ければ空欄のまま', () => {
    expect(review()).toEqual({ check: '', issues: '' })
  })

  test('済 は状況が変わらなければ済のまま', () => {
    expect(
      review({
        storedCheck: CHECK_DONE,
        storedIssues: '店名で照合した座標',
        issues: ['店名で照合した座標'],
      }),
    ).toEqual({ check: CHECK_DONE, issues: '店名で照合した座標' })
  })

  test('済 でも座標が変わったら要確認に戻す', () => {
    const result = review({
      storedCheck: CHECK_DONE,
      storedIssues: '店名で照合した座標',
      issues: ['店名で照合した座標'],
      coordChanged: true,
    })
    expect(result.check).toBe(CHECK_TODO)
    expect(result.issues).toContain(CHANGED_MARK)
  })

  test('済 でも確認事項が変わったら要確認に戻す', () => {
    const result = review({
      storedCheck: CHECK_DONE,
      storedIssues: '店名で照合した座標',
      issues: ['住所を書き換えて求めた座標'],
    })
    expect(result.check).toBe(CHECK_TODO)
    expect(result.issues).toContain('住所を書き換えて求めた座標')
    expect(result.issues).toContain(CHANGED_MARK)
  })

  test('済 で確認事項が全部消えても、変化として一度は知らせる', () => {
    const result = review({
      storedCheck: CHECK_DONE,
      storedIssues: '店名で照合した座標',
      issues: [],
    })
    expect(result).toEqual({ check: CHECK_TODO, issues: CHANGED_MARK })
  })

  test('その要確認を人が済にしたら、次回は落ち着く（何度も蒸し返さない）', () => {
    const first = review({
      storedCheck: CHECK_DONE,
      storedIssues: '店名で照合した座標',
      issues: [],
    })
    // 人が改めて 済 と書いた状態で、もう一度回す
    const second = review({
      storedCheck: CHECK_DONE,
      storedIssues: first.issues,
      issues: [],
    })
    expect(second).toEqual({ check: CHECK_DONE, issues: '' })
  })

  test('機械が立てた要確認は、理由が消えたら下ろす', () => {
    expect(
      review({
        storedCheck: CHECK_TODO,
        storedIssues: '店名で照合した座標',
        issues: [],
      }),
    ).toEqual({ check: '', issues: '' })
  })

  test('人が理由なしに付けた要確認は消さない', () => {
    expect(review({ storedCheck: CHECK_TODO, storedIssues: '', issues: [] })).toEqual({
      check: CHECK_TODO,
      issues: '',
    })
  })

  test('人が独自の言葉を書いた行は値に触らない', () => {
    expect(
      review({
        storedCheck: '市に問い合わせ中',
        issues: ['店名で照合した座標'],
      }),
    ).toEqual({ check: '市に問い合わせ中', issues: '店名で照合した座標' })
  })

  test('確認事項が複数あれば並べる', () => {
    expect(
      review({ issues: ['フリガナが空', '座標が無い（地図に出ない）'] }).issues,
    ).toBe('フリガナが空 / 座標が無い（地図に出ない）')
  })
})

describe('非表示', () => {
  test('非表示の行は機械が触らない（確認も確認事項もそのまま）', () => {
    expect(
      review({
        storedCheck: CHECK_HIDDEN,
        storedIssues: '座標が無い（地図に出ない）',
        issues: ['原本と違う: 住所'],
        coordChanged: true,
      }),
    ).toEqual({ check: CHECK_HIDDEN, issues: '座標が無い（地図に出ない）' })
  })

  test('前後の空白があっても非表示と見なす', () => {
    expect(isHidden(' 非表示 ')).toBe(true)
    expect(isHidden('済')).toBe(false)
    expect(isHidden('')).toBe(false)
  })
})
