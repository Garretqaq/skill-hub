import { expect, test } from 'vitest'
import { stripCreds } from '@/lib/config'

test('strips credentials from url', () => {
  expect(stripCreds('https://tok@git.example.com/a/b.git')).toBe('https://git.example.com/a/b.git')
})

test('strips both username and password', () => {
  expect(stripCreds('https://user:pass@github.com/repo.git')).toBe('https://github.com/repo.git')
})

test('handles url without credentials', () => {
  expect(stripCreds('https://github.com/repo.git')).toBe('https://github.com/repo.git')
})

test('handles invalid url gracefully', () => {
  expect(stripCreds('not-a-url')).toBe('not-a-url')
})
