import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { isAllowedExternalUrl, setAllowedCanvasHost } from './externalLinks'

beforeEach(() => setAllowedCanvasHost(null))

describe('isAllowedExternalUrl', () => {
  it('allows the documentation and sign-in hosts the app links to', () => {
    for (const url of [
      'https://accounts.google.com/o/oauth2/v2/auth?x=1',
      'https://docs.google.com/document/d/abc/edit',
      'https://drive.google.com/open?id=abc',
      'https://aistudio.google.com',
      'https://boisestate.ai/api-keys',
      'https://community.instructure.com/en/kb/articles/662901',
      'https://github.com/owner/repo/releases/latest',
      'https://boisestateecampus.atlassian.net/wiki/x/ABC',
    ]) {
      expect(isAllowedExternalUrl(url), url).toBe(true)
    }
  })

  it('refuses an unknown host', () => {
    expect(isAllowedExternalUrl('https://example.com')).toBe(false)
    expect(isAllowedExternalUrl('https://evil.test/?token=abc')).toBe(false)
  })

  // The reason this is an exact-host set rather than a suffix check. A suffix check for
  // ".google.com" accepts "google.com.attacker.example", which is exactly the shape an
  // exfiltration URL takes.
  it('refuses a lookalike host that merely contains an allowed one', () => {
    expect(isAllowedExternalUrl('https://docs.google.com.attacker.example/')).toBe(false)
    expect(isAllowedExternalUrl('https://notgithub.com/')).toBe(false)
    expect(isAllowedExternalUrl('https://github.com.evil.test/')).toBe(false)
  })

  it('refuses non-HTTPS schemes', () => {
    // file: and custom protocol handlers are how an unfiltered openExternal becomes a
    // "run something" primitive on Windows.
    expect(isAllowedExternalUrl('http://docs.google.com/')).toBe(false)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('ms-msdt:/id')).toBe(false)
  })

  it('refuses unparseable input', () => {
    expect(isAllowedExternalUrl('')).toBe(false)
    expect(isAllowedExternalUrl('not a url')).toBe(false)
  })

  describe('the configured Canvas host', () => {
    it('is allowed once a course URL has been saved', () => {
      expect(isAllowedExternalUrl('https://school.instructure.com/courses/1')).toBe(false)
      setAllowedCanvasHost('https://school.instructure.com/courses/1')
      expect(isAllowedExternalUrl('https://school.instructure.com/courses/1')).toBe(true)
    })

    it('does not allow a different Canvas instance', () => {
      setAllowedCanvasHost('https://school.instructure.com/courses/1')
      expect(isAllowedExternalUrl('https://other.instructure.com/courses/1')).toBe(false)
    })

    it('is cleared when the course URL is removed', () => {
      setAllowedCanvasHost('https://school.instructure.com/courses/1')
      setAllowedCanvasHost(null)
      expect(isAllowedExternalUrl('https://school.instructure.com/courses/1')).toBe(false)
    })

    it('ignores a non-HTTPS course URL rather than pinning its host', () => {
      setAllowedCanvasHost('http://school.instructure.com/courses/1')
      expect(isAllowedExternalUrl('https://school.instructure.com/courses/1')).toBe(false)
    })

    it('ignores an unparseable course URL', () => {
      setAllowedCanvasHost('nonsense')
      expect(isAllowedExternalUrl('https://school.instructure.com/')).toBe(false)
    })
  })
})

/**
 * Every link in the interface must be openable.
 *
 * An allowlist miss is silent — `openExternalSafely` returns without opening anything — so a
 * link to an unlisted host looks exactly like a dead button. This walks the renderer source and
 * fails if any href points somewhere the allowlist would refuse, which is the only way that
 * mistake announces itself.
 */
describe('every href in the renderer is openable', () => {
  function collectSources(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) collectSources(path, found)
      else if (/\.tsx?$/.test(entry)) found.push(path)
    }
    return found
  }

  it('links only to allowlisted hosts', () => {
    const srcDir = join(__dirname, '..', '..', 'src')
    const offenders: string[] = []

    for (const file of collectSources(srcDir)) {
      const contents = readFileSync(file, 'utf-8')
      for (const match of contents.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
        if (!isAllowedExternalUrl(match[1])) {
          offenders.push(`${file.split('/src/')[1]} -> ${match[1]}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
