/** @author sgz @since 2026-07-03 */
import { expect, test } from 'vitest'
import { MARKETPLACE_NAME } from '@/lib/config'
test('config loads default name', () => {
  expect(typeof MARKETPLACE_NAME).toBe('string')
})
