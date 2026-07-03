import { expect, test } from 'vitest'
import { MARKETPLACE_NAME } from '@/lib/config'
test('config loads default name', () => {
  expect(typeof MARKETPLACE_NAME).toBe('string')
})
