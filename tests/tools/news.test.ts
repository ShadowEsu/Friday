import { describe, expect, it } from 'vitest'
import { dedupeHeadlines } from '../../src/main/tools/news'

describe('dedupeHeadlines', () => {
  it('drops near-duplicate headlines covering the same story from different outlets', () => {
    const titles = [
      'Senate passes new budget bill after late-night vote',
      'Senate passes budget bill in late night vote',
      'Local team wins championship in overtime thriller'
    ]
    const result = dedupeHeadlines(titles, 5)
    expect(result).toHaveLength(2)
  })

  it('keeps genuinely distinct stories', () => {
    const titles = [
      'Senate passes new budget bill after late-night vote',
      'Local team wins championship in overtime thriller',
      'Tech company announces new product line'
    ]
    const result = dedupeHeadlines(titles, 5)
    expect(result).toHaveLength(3)
  })

  it('filters out too-short/empty junk entries', () => {
    const titles = ['', '  ', 'Ad', 'A real headline about something happening today']
    const result = dedupeHeadlines(titles, 5)
    expect(result).toEqual(['A real headline about something happening today'])
  })

  it('respects the maxItems cap', () => {
    const titles = [
      'Senate passes new budget bill after late night vote',
      'Local team wins championship in overtime thriller',
      'Tech company announces new product line',
      'Wildfire forces evacuations near mountain town',
      'Central bank holds interest rates steady this quarter'
    ]
    const result = dedupeHeadlines(titles, 3)
    expect(result).toHaveLength(3)
  })

  it('preserves input order for kept headlines', () => {
    const titles = [
      'Senate passes new budget bill after late night vote',
      'Local team wins championship in overtime thriller'
    ]
    expect(dedupeHeadlines(titles, 5)).toEqual(titles)
  })
})
