import { describe, expect, it, vi } from 'vitest'

// updateCheck imports `app` to read the running version and to set a User-Agent. Neither matters
// to compareVersions, but the import must resolve for the module to load outside Electron.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' } }))

const { compareVersions } = await import('./updateCheck')

describe('compareVersions', () => {
  /**
   * The case this file was written for. 0.9.10 is the first version whose patch number runs to
   * two digits, and compared as strings "0.9.10" sorts *below* "0.9.9" — so every installed copy
   * would decide it was already current and the update banner would never appear. Nothing would
   * error; the fix would simply reach nobody, which is the same silent failure as shipping
   * without bumping the version at all.
   */
  it('reads 0.9.10 as newer than 0.9.9', () => {
    expect(compareVersions('0.9.10', '0.9.9')).toBe(1)
    expect(compareVersions('0.9.9', '0.9.10')).toBe(-1)
  })

  it('treats double digits as numbers in every position', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('10.0.0', '9.9.9')).toBe(1)
  })

  it('reports equality', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('accepts a leading v on either side', () => {
    expect(compareVersions('v1.2.4', '1.2.3')).toBe(1)
  })

  it('treats a missing part as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.3', '1.2.9')).toBe(1)
  })

  /** A release candidate is older than the release it is a candidate for. */
  it('ranks a pre-release below its own release', () => {
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1)
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.1')).toBe(1)
  })
})
