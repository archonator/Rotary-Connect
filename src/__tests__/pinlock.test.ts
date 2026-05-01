/**
 * Tests für die Schwache-PIN-Heuristik in PinLock.
 *
 * `isWeakPin` lehnt PINs ab, die:
 *   • alle dieselbe Ziffer haben (0000, 9999, 111111, …)
 *   • streng aufsteigend sind (1234, 0123, 123456)
 *   • streng absteigend sind (4321, 654321)
 *   • in der "Top-30"-Liste der bekanntesten Codes stehen
 *     (1212, 2580, 111222, …)
 *
 * Akzeptierte PINs sind hingegen "echt" zufällig wirkende
 * Zifferkombinationen (5060, 7193, 408291, …).
 */

import { describe, it, expect } from 'vitest'
import { isWeakPin } from '../components/ui/PinLock'

describe('isWeakPin', () => {
  it('rejects all-same-digit PINs', () => {
    expect(isWeakPin('0000')).toBe(true)
    expect(isWeakPin('1111')).toBe(true)
    expect(isWeakPin('999999')).toBe(true)
  })

  it('rejects strict ascending sequences', () => {
    expect(isWeakPin('1234')).toBe(true)
    expect(isWeakPin('0123')).toBe(true)
    expect(isWeakPin('123456')).toBe(true)
  })

  it('rejects strict descending sequences', () => {
    expect(isWeakPin('4321')).toBe(true)
    expect(isWeakPin('654321')).toBe(true)
  })

  it('rejects well-known weak PINs', () => {
    expect(isWeakPin('1212')).toBe(true)
    expect(isWeakPin('2580')).toBe(true)
    expect(isWeakPin('111222')).toBe(true)
  })

  it('accepts non-trivial PINs', () => {
    expect(isWeakPin('7193')).toBe(false)
    expect(isWeakPin('408291')).toBe(false)
    expect(isWeakPin('5060')).toBe(false)
  })
})
