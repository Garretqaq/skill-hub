/** @author sgz @since 2026-07-03 */
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
})
