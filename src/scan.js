// 全盘扫描：找各工具的 exe 位置，带缓存和可信度评分
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { EXE_NAMES } from './tools.js'

const SEP = String.fromCharCode(92) // 反斜杠，避免源码转义歧义

const CACHE_FILE = () =>
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'plugins-data', 'envdoctor', 'scan-cache.json')

const TTL_MS = 10 * 60 * 1000

// 这些路径里的 exe 多半是别的软件内置的副本，不是独立安装
const SUSPECT = [
  SEP + 'app.asar', SEP + 'resources' + SEP, SEP + 'node_modules' + SEP,
  SEP + 'binaries' + SEP, SEP + 'dependencies' + SEP, 'windowsapps',
  SEP + '_download' + SEP, SEP + '.webpack' + SEP, SEP + 'app-', SEP + 'unins',
]

/** 可信度评分：越高越像"独立正式安装" */
export function scorePath(p, tool, root) {
  const l = p.toLowerCase()
  const depth = p.split(SEP).length
  let sc = 0
  const R = String(root || 'D:' + SEP + 'tools').toLowerCase().replace(/[\/]+$/, '')
  if (l.startsWith(R + SEP)) sc += 100
  if (l.startsWith('d:' + SEP + 'tools' + SEP)) sc += 100
  if (/^d:.(platform-tools|nodejs|python)./.test(l)) sc += 70
  if (tool && tool.prefer && tool.prefer.test(p)) sc += 60
  if (/^c:.program files.[^\\]+.[^\\]+$/i.test(p)) sc += 40
  if (l.includes(SEP + 'appdata' + SEP + 'local' + SEP + 'programs' + SEP)) sc += 35
  if (depth <= 5) sc += 15
  else if (depth >= 7) sc -= 25
  for (const bad of SUSPECT) if (l.includes(bad)) sc -= 60
  return sc
}

function run(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let out = '', err = ''
    const p = spawn(cmd, args, { windowsHide: true })
    if (p.stdout) p.stdout.on('data', (d) => { out += d })
    if (p.stderr) p.stderr.on('data', (d) => { err += d })
    const t = setTimeout(() => { try { p.kill() } catch {} }, timeoutMs)
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }) })
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e) }) })
  })
}

function roots(extra) {
  const home = homedir()
  return [
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'D:\\',
    join(home, 'AppData', 'Local'),
    'C:\\ProgramData',
  ].filter((r) => existsSync(r)).concat(extra && existsSync(extra) ? [extra] : [])
}

/** 读缓存。默认永久有效——只有用户主动点「全盘体检」才重扫 */
export function loadCache(maxAgeMs = Infinity) {
  try {
    const d = JSON.parse(readFileSync(CACHE_FILE(), 'utf8'))
    if (!d.map) return null
    if (maxAgeMs === Infinity) return d.map
    if (Date.now() - (d.at || 0) < maxAgeMs) return d.map
  } catch {}
  return null
}

/** 缓存的生成时间（毫秒时间戳），没有则 0 */
export function cacheAt() {
  try {
    const d = JSON.parse(readFileSync(CACHE_FILE(), 'utf8'))
    return Number(d.at) || 0
  } catch { return 0 }
}

export function saveCache(map) {
  try {
    mkdirSync(dirname(CACHE_FILE()), { recursive: true })
    writeFileSync(CACHE_FILE(), JSON.stringify({ at: Date.now(), map }, null, 1), 'utf8')
  } catch {}
}

/** 全盘扫描，返回 { exeName: [路径...] } */
export async function scanDisk(log, extraRoot) {
  const names = EXE_NAMES
  const map = {}
  const ps = [
    '$names = @(' + names.map((n) => "'" + n + "'").join(',') + ')',
    '$roots = @(' + roots(extraRoot).map((r) => "'" + r.replace(/\\/g, '\\\\') + "'").join(',') + ')',
    'foreach ($r in $roots) {',
    "  Get-ChildItem -Path $r -Recurse -Filter '*.exe' -File -ErrorAction SilentlyContinue |",
    '    Where-Object { $names -contains $_.Name } |',
    '    ForEach-Object { $_.FullName }',
    '}',
  ].join('\n')

  log?.info?.('开始全盘扫描…')
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 240000)
  for (const line of r.out.split(/\r?\n/)) {
    const p = line.trim()
    if (!p) continue
    const n = basename(p).toLowerCase()
    if (!map[n]) map[n] = []
    map[n].push(p)
  }
  for (const k of Object.keys(map)) {
    map[k] = [...new Set(map[k])].slice(0, 15)
  }
  saveCache(map)
  log?.info?.('扫描完成，' + Object.keys(map).length + ' 类可执行文件')
  return map
}

export function hitsFor(map, tool) {
  return (map || {})[tool.exe.toLowerCase()] || []
}
