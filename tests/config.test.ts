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

// 'error:' 会被 new URL 当成合法 scheme（host 为空），曾导致整条错误消息原样返回、凭据泄露
test('strips credentials embedded in a git error message', () => {
  const msg = 'error: Command failed: git -c http.proxy=http://u:pw@1.2.3.4:10001/ clone https://tok@github.com/a/b'
  expect(stripCreds(msg)).toBe('error: Command failed: git -c http.proxy=http://1.2.3.4:10001/ clone https://github.com/a/b')
})

test('strips proxy credentials regardless of scheme', () => {
  expect(stripCreds('failed: socks5://u:pw@127.0.0.1:1080')).toBe('failed: socks5://127.0.0.1:1080')
})
