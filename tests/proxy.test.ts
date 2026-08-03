/** @author sgz @since 2026-08-03 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import { matchNoProxy, parseNoProxy, validateProxyUrl, withProxyAuth } from '@/lib/proxy'

test('parseNoProxy: 逗号分隔、去空、转小写', () => {
  expect(parseNoProxy(' Corp.com , ,git.internal ')).toEqual(['corp.com', 'git.internal'])
  expect(parseNoProxy('')).toEqual([])
})

test('matchNoProxy: 后缀匹配、忽略端口、不误伤同后缀词', () => {
  const list = ['corp.com']
  expect(matchNoProxy('corp.com', list)).toBe(true)
  expect(matchNoProxy('git.corp.com', list)).toBe(true)
  expect(matchNoProxy('GIT.CORP.COM', list)).toBe(true)
  expect(matchNoProxy('corp.com:8443', list)).toBe(true)
  expect(matchNoProxy('notcorp.com', list)).toBe(false) // 只按点分边界匹配
  expect(matchNoProxy('github.com', list)).toBe(false)
  expect(matchNoProxy('git.corp.com', [])).toBe(false)
  expect(matchNoProxy('git.corp.com', ['.corp.com'])).toBe(true) // 兼容前导点写法
})

test('validateProxyUrl: 允许 http/https/socks5，拒绝其它', () => {
  expect(validateProxyUrl(' http://127.0.0.1:7890 ')).toBe('http://127.0.0.1:7890')
  expect(validateProxyUrl('socks5://127.0.0.1:1080')).toBe('socks5://127.0.0.1:1080')
  expect(validateProxyUrl('socks5h://127.0.0.1:1080')).toBe('socks5h://127.0.0.1:1080')
  expect(validateProxyUrl('')).toBe('') // 空 = 停用
  expect(() => validateProxyUrl('ftp://h:1')).toThrow(/unsupported proxy scheme/)
  expect(() => validateProxyUrl('127.0.0.1:7890')).toThrow(/invalid proxy url/)
})

test('withProxyAuth: user:pass 注入到用户名密码位', () => {
  expect(withProxyAuth('http://h:7890', 'u:p')).toBe('http://u:p@h:7890')
  expect(withProxyAuth('http://h:7890', 'u')).toBe('http://u@h:7890')
  expect(withProxyAuth('http://h:7890', undefined)).toBe('http://h:7890')
  expect(withProxyAuth('', 'u:p')).toBe('')
})

// 以下用例依赖 settings.json，靠 chdir 到临时目录隔离（同 settings.test.ts 的做法）。
// config.ts 的 DATA_DIR 在模块加载时就 resolve 定死，故每次都 resetModules 后重新 import。
async function inTmpDir<T>(settings: object, fn: (m: typeof import('@/lib/proxy')) => T): Promise<T> {
  const cwd = process.cwd()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shproxy-'))
  process.chdir(tmp)
  try {
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'data', 'settings.json'), JSON.stringify(settings))
    vi.resetModules()
    return fn(await import('@/lib/proxy'))
  } finally {
    process.chdir(cwd)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

test('proxyArgsFor: 未配代理时不注入', async () => {
  await inTmpDir({}, m => {
    expect(m.proxyArgsFor('https://github.com/o/r.git')).toEqual([])
  })
})

test('proxyArgsFor: 配了代理则前插 -c，命中 noProxy 与非 http 目标不注入', async () => {
  await inTmpDir({ proxyUrl: 'http://127.0.0.1:7890', noProxy: 'corp.com' }, m => {
    expect(m.proxyArgsFor('https://github.com/o/r.git')).toEqual([
      '-c', 'http.proxy=http://127.0.0.1:7890',
      '-c', 'https.proxy=http://127.0.0.1:7890',
    ])
    expect(m.proxyArgsFor('https://git.corp.com/o/r.git')).toEqual([]) // 命中名单
    expect(m.proxyArgsFor('ssh://git@github.com/o/r.git')).toEqual([]) // http.proxy 对 ssh 无效
    expect(m.proxyArgsFor('git@github.com:o/r.git')).toEqual([])       // scp 式地址
  })
})

test('getProxyUrl: 单独保存的 proxyAuth 注入进地址', async () => {
  await inTmpDir({ proxyUrl: 'http://127.0.0.1:7890', proxyAuth: 'u:p' }, m => {
    expect(m.getProxyUrl()).toBe('http://u:p@127.0.0.1:7890')
    expect(m.getProxyAuth()).toBe('u:p')
  })
})

test('proxyDispatcherFor: socks 代理不给 dispatcher（/proxy 直连），http 代理给', async () => {
  await inTmpDir({ proxyUrl: 'socks5://127.0.0.1:1080' }, m => {
    expect(m.proxyDispatcherFor('https://github.com/')).toBeUndefined()
  })
  await inTmpDir({ proxyUrl: 'http://127.0.0.1:7890' }, m => {
    expect(m.proxyDispatcherFor('https://github.com/')).toBeDefined()
  })
})
