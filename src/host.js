// 环境体检 · 宿主半边
// 安装根目录可配置（默认自动选盘）；全盘扫描只做一次；稳定/最新/指定版本；用户级 PATH
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync, readFileSync, readdirSync, copyFileSync, chmodSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { toolsFor, PACKS, expandPack } from './tools.js'
import { encodeShare, decodeShare } from './share.js'
import { scanDisk, hitsFor, loadCache, scorePath, cacheAt } from './scan.js'
import { loadSettings, saveSettings } from './settings.js'

export const name = 'env-doctor'
export const inject = ['webServer']

const PREFIX = '/envdoctor/api'
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let out = '', err = ''
    const p = spawn(cmd, args, { windowsHide: true, ...opts })
    if (p.stdout) p.stdout.on('data', (d) => { out += d })
    if (p.stderr) p.stderr.on('data', (d) => { err += d })
    const t = setTimeout(() => { try { p.kill() } catch {} }, opts.timeoutMs || 120000)
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }) })
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: String(e) }) })
  })
}

// 每次取最新设置（用户可能刚改过根目录）
const cfg = () => {
  const s = loadSettings()
  return { ...s, tools: toolsFor(s.root), dl: join(s.root, '_download') }
}

// 某工具实际该进 PATH 的目录：以真正检测到的 exe 为准，再补预设目录和特殊子目录
function dirsForTool(t, exePath) {
  const out = []
  if (exePath) {
    const d = dirname(exePath)
    out.push(d)
    // Python 的 pip / Scripts
    if (t.id === 'python') {
      out.push(join(d, 'Scripts'))
      out.push(join(d, '..', 'Scripts'))
    }
    // Git 的 cmd 版（git.exe 在 bin 里时，cmd 才是标准入口）
    if (t.id === 'git') {
      out.push(join(dirname(d), 'cmd'))
      out.push(join(dirname(d), 'mingw64', 'bin'))
    }
  }
  for (const b of t.bindir()) out.push(b)
  const seen = new Set()
  return out.filter((d) => {
    if (!d || seen.has(d.toLowerCase())) return false
    seen.add(d.toLowerCase())
    try { return existsSync(d) } catch { return false }
  })
}

// 找某工具当前最可信的已装 exe
function installedExe(t, map) {
  const hits = hitsFor(map || {}, t)
  const known = t.bindir().map((d) => join(d, t.exe)).filter(existsSync)
  return [...new Set([...known, ...hits])]
    .filter(existsSync)
    .sort((a, b) => scorePath(b, t, loadSettings().root) - scorePath(a, t, loadSettings().root))[0] || null
}

// ---------- 安装进度 ----------
const PROGRESS = {} // id -> { stage, text, done, total, startedAt, error }

function setProg(id, patch) {
  PROGRESS[id] = { ...(PROGRESS[id] || {}), ...patch, at: Date.now() }
}
function getProg(id) {
  const p = PROGRESS[id]
  if (!p) return null
  // 下载占 0-80%，解压 86%，复制 94%，校验 98%，完成 100%
  let pct = 0
  if (p.stage === 'download') pct = p.total > 0 ? Math.max(1, Math.min(80, Math.round((p.done / p.total) * 80))) : 0
  else if (p.stage === 'extract') pct = 86
  else if (p.stage === 'copy') pct = 94
  else if (p.stage === 'verify') pct = 98
  else if (p.stage === 'done') pct = 100
  return { ...p, pct, elapsedMs: p.startedAt ? Date.now() - p.startedAt : 0 }
}

// 用 HEAD 拿 Content-Length（拿不到就当 0，前端显示不确定进度）
async function headSize(url) {
  const r = await run('curl.exe', ['-sSIL', '-m', '20',
    '-H', 'Accept: application/octet-stream', url], { timeoutMs: 30000 })
  const m = (r.out || '').match(/content-length:\s*(\d+)/i)
  return m ? Number(m[1]) : 0
}

// ---------- PATH（用户 + 系统）----------
let pathUser = '' // 用户 PATH：只往这里写
let pathAll = ''  // 用户 + 系统：只用来判断"到底有没有"

async function regGetPath(hive) {
  const r = await run('reg', ['query', hive, '/v', 'Path'])
  if (r.code !== 0) return ''
  const m = r.out.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i)
  return m ? m[1].trim() : ''
}

async function refreshPaths() {
  pathUser = await regGetPath('HKCU\\Environment')
  const sys = (await run('powershell.exe', ['-NoProfile', '-Command',
    "[Environment]::GetEnvironmentVariable('Path','Machine')"], { timeoutMs: 15000 })).out || ''
  pathAll = [pathUser, sys.trim()].filter(Boolean).join(';')
  return { user: pathUser, all: pathAll }
}

async function pathSet(v) {
  const r = await run('reg', ['add', 'HKCU\\Environment', '/v', 'Path',
    '/t', 'REG_EXPAND_SZ', '/d', v, '/f'])
  if (r.code !== 0) return false
  await run('powershell.exe', ['-NoProfile', '-Command',
    `Add-Type -Namespace W -Name N -MemberDefinition '[DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Auto)]public static extern IntPtr SendMessageTimeout(IntPtr a,uint b,UIntPtr c,string d,uint e,uint f,out UIntPtr g);'; $r=[UIntPtr]::Zero; [W.N]::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,'Environment',2,3000,[ref]$r) | Out-Null`],
    { timeoutMs: 20000 })
  return true
}
// 目录归一化：去尾部斜杠、转小写（PATH 里经常带尾斜杠，直接比会漏）
const normDir = (d) => String(d || '').trim().replace(/[\\/]+$/, '').toLowerCase()

const inPath = (dir) => {
  const want = normDir(dir)
  if (!want) return false
  return String(pathAll || '').split(';').map(normDir).filter(Boolean).includes(want)
}

// ---------- 版本探测 ----------
const VERSION_ARGS = {
  '7zip': ['i'], node: ['--version'], python: ['--version'], git: ['--version'],
  ffmpeg: ['-version'], pwsh: ['-v'], uv: ['--version'], adb: ['version'],
  chrome: null, // GUI 程序：绝不执行，只读文件属性
}

async function fileVersion(p) {
  try {
    const r = await run('powershell.exe', ['-NoProfile', '-Command',
      `(Get-Item -LiteralPath '${p}').VersionInfo.ProductVersion`], { timeoutMs: 8000 })
    return (r.out || '').trim().slice(0, 40)
  } catch { return '' }
}

async function safeVersion(t, exePath) {
  const has = Object.prototype.hasOwnProperty.call(VERSION_ARGS, t.id)
  const args = has ? VERSION_ARGS[t.id] : ['--version']
  if (args === null) return await fileVersion(exePath)
  const r = await run(exePath, args, { timeoutMs: 8000 })
  const line = (r.out || r.err || '').split(/\r?\n/).find((l) => l.trim()) || ''
  const txt = line.trim()
  return txt ? txt.slice(0, 70) : await fileVersion(exePath)
}

async function latestOf(tool, log) {
  try { if (typeof tool.latest === 'function') return await tool.latest() } catch (e) { log?.warn?.('查最新版失败: ' + e.message) }
  return tool.stable
}
const versionInfo = (t) => ({ stable: t.stable, presets: t.versions || null, hasLatest: typeof t.latest === 'function' })

// ---------- 审计 ----------
async function audit(forceScan, log) {
  const C = cfg()
  const PP = await refreshPaths()
  pathAll = PP.all.replace(/%[^%]+%/g, '')

  let map = forceScan ? null : loadCache()
  const cached = Boolean(map)
  if (!map) map = await scanDisk(log, C.root)

  const out = []
  for (const t of C.tools) {
    const hits = hitsFor(map, t)
    const dirs = t.bindir()
    const known = dirs.map((d) => join(d, t.exe)).filter(existsSync)
    // 缓存里的路径可能已被删掉，必须过滤存在性，否则卸载后仍显示已装
    const all = [...new Set([...known, ...hits])].filter(existsSync)
      .sort((a, b) => scorePath(b, t, C.root) - scorePath(a, t, C.root))
    const best = all[0] || null
    const usable = Boolean(best && scorePath(best, t, C.root) >= 0)
    // PATH 判断以「实际 exe 所在目录」为准，不是预设安装目录
    const pdirs = usable ? dirsForTool(t, best) : []
    const pathOk = usable && pdirs.some((d) => inPath(d))

    let ver = ''
    if (best) ver = await safeVersion(t, best)

    out.push({
      id: t.id, name: t.name, category: t.category, desc: t.desc,
      installed: usable, path: best, version: ver,
      candidates: all.slice(0, 6),
      suspicious: all.filter((p) => scorePath(p, t, C.root) < 0).slice(0, 4),
      inPath: Boolean(pathOk), needPath: Boolean(usable && pdirs.length && !pathOk),
      bindir: pdirs, installable: t.kind !== 'manual', note: t.note || '',
      versions: versionInfo(t),
    })
  }
  return {
    ok: true, root: C.root, tools: out, pathValue: pathAll,
    packs: PACKS, shareServer: C.shareServer || '',
    scanned: !cached, cacheAt: cacheAt(), firstTime: !cached,
    defaults: C.defaults, settingsPath: C.settingsPath,
  }
}

// ---------- 下载 / 解压 ----------
async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true })
  const r = await run('curl.exe', ['-sSL', '--retry', '3', '--retry-delay', '2',
    '-H', 'Accept: application/octet-stream',
    '-m', '1800', '-o', dest, url], { timeoutMs: 1900000 })
  const size = existsSync(dest) ? statSync(dest).size : 0
  return { ok: r.code === 0 && size > 1024, size, err: r.err }
}

async function unzip(zip, dest, strip = 0) {
  mkdirSync(dest, { recursive: true })
  const tmp = dest + '_tmp'
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })

  let ok = false
  let r = await run('powershell.exe', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force`], { timeoutMs: 900000 })
  if (r.code === 0) ok = true

  if (!ok) { // 兜底：.NET 直接解，不看扩展名
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
    const r2 = await run('powershell.exe', ['-NoProfile', '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `[System.IO.Compression.ZipFile]::ExtractToDirectory('${zip}', '${tmp}')`], { timeoutMs: 900000 })
    if (r2.code === 0) ok = true
  }
  if (!ok) {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
    return false
  }

  let src = tmp
  if (strip) {
    const entries = readdirSync(tmp)
    if (entries.length === 1 && statSync(join(tmp, entries[0])).isDirectory()) src = join(tmp, entries[0])
  }
  // 注意：-LiteralPath 不展开通配符，必须用 Get-ChildItem 列出子项再 Copy-Item
  const cp = await run('powershell.exe', ['-NoProfile', '-Command',
    `Get-ChildItem -LiteralPath '${src}' -Force | Copy-Item -Destination '${dest}' -Recurse -Force -ErrorAction Stop`],
    { timeoutMs: 600000 })
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  if (cp.code !== 0) return false
  // 复制后必须确认目录里真有东西，否则不能算成功
  try {
    if (readdirSync(dest).length === 0) return false
  } catch { return false }
  return true
}

async function ghAsset(repo, pattern, version) {
  const tags = (version && version !== 'latest' && version !== 'stable')
    ? (String(version).startsWith('v') ? [String(version)] : ['v' + version, String(version)])
    : ['']
  const re = new RegExp(pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
  for (const tag of tags) {
    const api = tag
      ? `https://api.github.com/repos/${repo}/releases/tags/${tag}`
      : `https://api.github.com/repos/${repo}/releases/latest`
    const r = await run('curl.exe', ['-sSL', '-m', '60', '-H', 'User-Agent: envdoctor', api], { timeoutMs: 70000 })
    try {
      const d = JSON.parse(r.out)
      const a = (d.assets || []).find((x) => re.test(x.name))
      if (a) return { url: a.url, name: a.name, size: a.size } // API 直链 + 大小
    } catch {}
  }
  return null
}

// ---------- 安装 ----------
async function install(id, mode = 'stable', custom = '', log) {
  const C = cfg()
  const t = C.tools.find((x) => x.id === id)
  if (!t) return { ok: false, message: '没有这个工具' }
  if (t.kind === 'manual') return { ok: false, message: t.note }

  mkdirSync(C.root, { recursive: true })
  mkdirSync(C.dl, { recursive: true })

  let spec
  if (mode === 'latest') spec = t.resolve('custom', await latestOf(t, log))
  else if (mode === 'custom') {
    if (!custom) return { ok: false, message: '没填版本号' }
    spec = t.resolve('custom', String(custom).trim())
  } else spec = t.resolve('stable')

  if (spec.gh) {
    const a = await ghAsset(spec.gh.repo, spec.gh.asset, spec.gh.version)
    if (!a) return { ok: false, message: `GitHub 取不到 ${spec.gh.repo} ${spec.gh.version} 的安装包` }
    log?.info?.('解析到 ' + a.name)
    spec = { ...spec, url: a.url, dlName: a.name, size: a.size || 0, label: spec.label || a.name }
  }

  const wantZip = t.kind === 'zip' || t.kind === 'chrome'
  let dlName = spec.dlName || basename((spec.url || '').split('?')[0] || '')
  if (!dlName || /^\d+$/.test(dlName) || !dlName.includes('.')) dlName = t.id + (wantZip ? '.zip' : '.exe')
  else if (wantZip && !/\.zip$/i.test(dlName)) dlName += '.zip'
  spec.dlName = dlName

  const tgt = spec.target || t.target || (t.bindir()[0] || '')
  if (tgt) mkdirSync(tgt, { recursive: true })

  setProg(t.id, { stage: 'prep', text: '准备', done: 0, total: spec.size || 0, startedAt: Date.now(), error: '' })

  // 收尾：加 PATH → 找到 exe → 跑一次版本验证
  const finish = async (r) => {
    if (!r || !r.ok) return r

    // 1) 自动加用户 PATH
    let addedPath = false
    try {
      const pr = await fixPath([t.id])
      if (pr.ok && pr.message.indexOf('加入') >= 0) { addedPath = true }
    } catch {}

    // 2) 确认 exe 真的落地了
    const exe = t.bindir().map((d) => join(d, t.exe)).filter(existsSync)[0] || null
    if (!exe) {
      r.ok = false
      r.message = r.message.replace(/解压完成|安装完成/, '解压/安装结束')
        + `，但没找到 ${t.exe}（可能包结构变了）`
      setProg(t.id, { stage: 'fail', error: '未找到 ' + t.exe })
      return r
    }

    // 3) 跑一次版本命令
    setProg(t.id, { stage: 'verify', text: '验证' })
    let v = ''
    try { v = await safeVersion(t, exe) } catch {}

    r.message += addedPath ? '，已加入 PATH（新开终端生效）' : '，PATH 已是最新'
    r.message += v ? `，验证 ${v}` : '，文件已就位'
    setProg(t.id, { stage: 'done', text: '完成' })
    return r
  }


  // 带进度的下载：边下边报文件大小
  const dlWith = async (url, dest, total) => {
    const tot = total || spec.size || await headSize(url)
    let done = 0
    const tick = () => { try { done = statSync(dest).size } catch {} setProg(t.id, { stage: 'download', done, total: tot }) }
    const poll = setInterval(tick, 300)
    setProg(t.id, { stage: 'download', text: '下载', done: 0, total: tot })
    try {
      const r = await download(url, dest)
      try { done = statSync(dest).size } catch {}
      setProg(t.id, { stage: 'download', done, total: tot || done })
      return r
    } finally { clearInterval(poll) }
  }

  const doZip = async (f, strip) => {
    setProg(t.id, { stage: 'extract', text: '解压' })
    const ok = await unzip(f, tgt, strip)
    setProg(t.id, { stage: 'verify', text: '校验' })
    return ok
  }

  if (t.kind === 'exe') {
    const f = join(C.dl, spec.dlName)
    log?.info?.('下载 ' + spec.url)
    const d = await dlWith(spec.url, f)
    if (!d.ok) { setProg(t.id, { stage: 'fail', error: d.err || '下载失败' }); return { ok: false, message: '下载失败：' + (d.err || '网络问题') } }
    setProg(t.id, { stage: 'extract', text: '安装' })
    const r = await run(f, spec.args || [], { timeoutMs: 900000 })
    if (r.code !== 0 && r.code !== 3010) { setProg(t.id, { stage: 'fail', error: 'exe 返回 ' + r.code }); return { ok: false, message: `安装器返回 ${r.code}（可能弹了 UAC，留意屏幕）` } }
    setProg(t.id, { stage: 'done', text: '完成' })
    return finish({ ok: true, message: `${spec.label} 安装完成` })
  }

  if (t.kind === 'zip') {
    const f = join(C.dl, spec.dlName)
    log?.info?.('下载 ' + spec.url)
    const d = await dlWith(spec.url, f)
    if (!d.ok) { setProg(t.id, { stage: 'fail', error: d.err || '下载失败' }); return { ok: false, message: '下载失败：' + (d.err || '网络问题') } }
    const ok = await doZip(f, t.strip || 0)
    setProg(t.id, { stage: ok ? 'done' : 'fail', text: ok ? '完成' : '解压失败', error: ok ? '' : '解压后目录为空' })
    return finish({ ok, message: ok ? `${spec.label} 解压完成` : '解压失败' })
  }

  // 单个可执行文件：直接下到 target/<exe>
  if (t.kind === 'single') {
    const name = spec.dlName || t.exe
    const f = join(C.dl, name)
    log?.info?.('下载 ' + spec.url)
    const d = await dlWith(spec.url, f)
    if (!d.ok) { setProg(t.id, { stage: 'fail', error: d.err || '下载失败' }); return { ok: false, message: '下载失败' } }
    setProg(t.id, { stage: 'copy', text: '写入' })
    try {
      mkdirSync(tgt, { recursive: true })
      const out = join(tgt, t.exe || name)
      copyFileSync(f, out)
      setProg(t.id, { stage: 'verify', text: '校验' })
      if (!existsSync(out)) { setProg(t.id, { stage: 'fail', error: '文件未落地' }); return { ok: false, message: '写入失败' } }
    } catch (e) {
      setProg(t.id, { stage: 'fail', error: String(e.message || e) })
      return { ok: false, message: '写入失败：' + (e.message || e) }
    }
    setProg(t.id, { stage: 'done', text: '完成' })
    return finish({ ok: true, message: `${spec.label} 下载完成` })
  }

  // 7z 自解压（Git 便携版）
  if (t.kind === '7zexe' || t.kind === 'gitportable') {
    let a = null
    if (spec.gh) {
      a = await ghAsset(spec.gh.repo, spec.gh.asset, spec.gh.version)
    } else if (spec.url) {
      a = { url: spec.url, name: spec.dlName || 'portable.7z.exe' }
    }
    if (!a) { setProg(t.id, { stage: 'fail', error: '取包失败' }); return { ok: false, message: '取不到安装包（GitHub 可能限流，稍后再试）' } }
    const f = join(C.dl, a.name)
    const d = await dlWith(a.url, f)
    if (!d.ok) { setProg(t.id, { stage: 'fail', error: '下载失败' }); return { ok: false, message: '下载失败' } }
    setProg(t.id, { stage: 'extract', text: '解压' })
    mkdirSync(tgt, { recursive: true })
    await run(f, [`-o${tgt}`, '-y'], { timeoutMs: 900000 })
    setProg(t.id, { stage: 'verify', text: '校验' })
    const cands = [join(tgt, 'cmd', t.exe), join(tgt, 'bin', t.exe), join(tgt, t.exe)]
    const ok = cands.some(existsSync)
    setProg(t.id, { stage: ok ? 'done' : 'fail', text: ok ? '完成' : '解压失败' })
    return finish({ ok, message: ok ? `${spec.label} 解压完成` : '解压失败' })
  }

  if (t.kind === 'chrome') {
    setProg(t.id, { stage: 'prep', text: '取下载地址' })
    const r = await run('curl.exe', ['-sSL', '-m', '60',
      'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'], { timeoutMs: 70000 })
    let url = ''
    try {
      const d = JSON.parse(r.out)
      const win = d.channels.Stable.downloads.chrome.find((x) => x.platform === 'win64')
      if (win) url = win.url
    } catch {}
    if (!url) { setProg(t.id, { stage: 'fail', error: '取地址失败' }); return { ok: false, message: '取 Chrome 地址失败' } }
    const f = join(C.dl, 'chrome-win64.zip')
    const d = await dlWith(url, f)
    if (!d.ok) { setProg(t.id, { stage: 'fail', error: '下载失败' }); return { ok: false, message: '下载失败' } }
    const ok = await doZip(f, 1)
    setProg(t.id, { stage: ok ? 'done' : 'fail', text: ok ? '完成' : '解压失败' })
    return finish({ ok, message: ok ? 'Chrome 解压完成' : '解压失败' })
  }

  setProg(t.id, { stage: 'fail', error: '未知类型' })
  return { ok: false, message: '未知安装类型' }
}

// ---------- 卸载 ----------
async function uninstall(id) {
  const C = cfg()
  const t = C.tools.find((x) => x.id === id)
  if (!t) return { ok: false, message: '没有这个工具' }
  const dir = t.target || t.bindir().find((d) => d.toLowerCase().startsWith(C.root.toLowerCase()))
  if (!dir || !dir.toLowerCase().startsWith(C.root.toLowerCase())) {
    return { ok: false, message: '不在安装目录下，请用系统卸载程序' }
  }
  if (!existsSync(dir)) return { ok: false, message: '目录不存在' }
  try {
    rmSync(dir, { recursive: true, force: true })
    return { ok: true, message: `${t.name} 已删除（${dir}）` }
  } catch (e) { return { ok: false, message: '删除失败：' + e.message } }
}

// ---------- PATH ----------
async function fixPath(ids) {
  const C = cfg()
  const PP = await refreshPaths()
  pathAll = PP.all.replace(/%[^%]+%/g, '')
  const parts = PP.user.split(';').map((s) => s.trim()).filter(Boolean)
  const map = loadCache() || {}
  const added = []

  for (const t of C.tools) {
    if (ids && ids.length && !ids.includes(t.id)) continue
    const exe = installedExe(t, map)
    // 以实际 exe 所在目录为准；没装才退回预设目录
    for (const dir of dirsForTool(t, exe)) {
      if (inPath(dir)) continue
      parts.push(dir)
      added.push(dir)
    }
  }

  if (!added.length) return { ok: true, message: 'PATH 已经是最新的，没改动' }
  const ok = await pathSet(parts.join(';'))
  return { ok, message: ok ? `已加入 ${added.length} 个目录，新开终端生效` : '写注册表失败', added }
}

function genBat() {
  return readFileSync(join(PLUGIN_ROOT, 'assets', 'add-to-path.bat'), 'utf8').replace(/\r?\n/g, '\r\n')
}

// 弹出 Windows 原生文件夹选择框，返回用户选的路径
async function pickFolder(start) {
  const initial = String(start || '').replace(/'/g, "''")
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$f = New-Object System.Windows.Forms.Form',
    '$f.TopMost = $true; $f.ShowInTaskbar = $false; $f.FormBorderStyle = "None"',
    '$f.Size = New-Object System.Drawing.Size(1,1); $f.Opacity = 0',
    '$f.StartPosition = "CenterScreen"; $f.Show()',
    '$dlg = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$dlg.Description = "选择工具安装目录（可在此新建文件夹）"',
    '$dlg.ShowNewFolderButton = $true',
    '$dlg.RootFolder = "MyComputer"',
    initial ? `if (Test-Path -LiteralPath '${initial}') { $dlg.SelectedPath = '${initial}' }` : '',
    '$r = $dlg.ShowDialog($f)',
    '$f.Close()',
    'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dlg.SelectedPath) }',
  ].filter(Boolean).join('\r\n')

  const r = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { timeoutMs: 600000 })
  const picked = (r.out || '').trim()
  if (!picked) return { ok: false, canceled: true, message: '没有选择目录' }
  return { ok: true, path: picked }
}

// ---------- 路由 ----------
export function apply(ctx) {
  const log = ctx.logger ? ctx.logger('envdoctor') : console
  const send = (res, code, obj) => {
    const body = JSON.stringify(obj)
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
    res.end(body)
  }
  const readBody = (req) => new Promise((resolve) => {
    let b = ''
    req.on('data', (c) => { b += c; if (b.length > 1 << 20) req.destroy() })
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}) } catch { resolve({}) } })
  })
  const route = (p, handler) => ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: PREFIX + p,
    handler: (req, res) => handler(req, res)
      .then((r) => send(res, 200, r))
      .catch((e) => send(res, 200, { ok: false, message: String(e && e.message || e) })),
  }), `envdoctor: 路由 ${p}`)

  route('/audit', async (req) => {
    const u = new URL(req.url, 'http://x')
    return audit(u.searchParams.get('scan') === '1', log)
  })
  route('/settings', async (req) => {
    const C = cfg()
    if (req.method === 'POST') {
      const b = await readBody(req)
      let next
      try {
        next = saveSettings({ root: b.root })
      } catch (e) {
        return { ok: false, message: '保存设置失败：' + (e.message || e) }
      }
      // 目录不存在就建（用户可能选了一个新文件夹）
      let created = false
      try {
        if (next.root && !existsSync(next.root)) { mkdirSync(next.root, { recursive: true }); created = true }
      } catch (e) {
        return { ok: false, message: `设置已存，但建目录失败：${e.message || e}`, root: next.root }
      }
      log.info?.('安装根目录改为 ' + next.root + (created ? '（已新建）' : ''))
      return { ok: true, root: next.root, defaults: next.defaults, created,
        message: `已保存，安装目录改为 ${next.root}${created ? '（已新建）' : ''}` }
    }
    return { ok: true, root: C.root, defaults: C.defaults, settingsPath: C.settingsPath }
  })
  route('/install', async (req) => {
    const b = await readBody(req)
    log.info?.(`安装 ${b.id} mode=${b.mode || 'stable'}`)
    return install(b.id, b.mode || 'stable', b.version || '', log)
  })
  // ---------- 分享 ----------
  // 导出：把「当前已装 + 版本」编码成分享码，可选上传换短码
  route('/share/export', async (req) => {
    const b = await readBody(req)
    const C = cfg()
    const A = await audit(false, log)
    const manifest = {
      name: b.name || '我的环境',
      author: b.author || '',
      root: C.root,
      createdAt: new Date().toISOString(),
      tools: A.tools.filter((x) => x.installed).map((x) => ({ id: x.id, version: x.version || '' })),
    }
    if (!manifest.tools.length) return { ok: false, message: '本地一个工具都没装，没什么可分享的' }

    const enc = encodeShare(manifest, b.pass || '')
    let shortCode = ''
    let uploadErr = ''
    if (b.upload) {
      if (!C.shareServer) {
        uploadErr = '没配分享服务地址'
      } else {
        const payload = enc.code.split('.').slice(1).join('.')
        const r = await run('curl.exe', ['-sS', '-m', '25', '-X', 'POST',
          C.shareServer + '/v1/env', '-H', 'Content-Type: application/json',
          '--data-binary', JSON.stringify({ d: payload })], { timeoutMs: 30000 })
        try {
          const j = JSON.parse(r.out)
          if (j.ok && j.code) shortCode = j.code
          else uploadErr = j.message || '上传失败'
        } catch { uploadErr = '服务端返回异常：' + (r.out || '').slice(0, 80) }
      }
    }
    return {
      ok: true, code: enc.code, shortCode, uploadErr,
      encrypted: enc.encrypted, count: manifest.tools.length,
      bytes: enc.bytes, manifest,
    }
  })

  // 导入：解析分享码（长码或 8 位短码），给出与本地对比
  route('/share/import', async (req) => {
    const b = await readBody(req)
    let code = String(b.code || '').trim().replace(/\s+/g, '')
    if (!code) return { ok: false, message: '分享码为空' }
    const C = cfg()
    let viaServer = false

    // 8 位纯字母数字 = 短码，去服务端取
    if (/^[0-9A-Za-z]{8}$/.test(code) && !code.includes('.')) {
      if (!C.shareServer) return { ok: false, message: '这是短码，但没配分享服务地址' }
      const r = await run('curl.exe', ['-sS', '-m', '20',
        C.shareServer + '/v1/env/' + code.toUpperCase()], { timeoutMs: 25000 })
      let j = null
      try { j = JSON.parse(r.out) } catch {}
      if (!j || !j.ok || !j.d) return { ok: false, message: (j && j.message) || '服务端查不到这个短码' }
      code = 'ENV1.' + j.d
      viaServer = true
    }

    let manifest
    try {
      manifest = decodeShare(code, b.pass || '')
    } catch (e) {
      return { ok: false, message: String(e.message || e) }
    }

    // 与本地对比
    const A = await audit(false, log)
    const localMap = {}
    for (const x of A.tools) localMap[x.id] = x

    const items = manifest.tools.map((m) => {
      const l = localMap[m.id]
      const want = String(m.version || '')
      const hasRaw = l && l.installed ? String(l.version || '') : ''
      const hasVer = (hasRaw.match(/\d+(\.\d+)+/) || [''])[0]
      const wantVer = (want.match(/\d+(\.\d+)+/) || [''])[0]
      const same = Boolean(l && l.installed && wantVer && hasVer && hasVer === wantVer)
      return {
        id: m.id,
        name: l ? l.name : m.id,
        want, has: hasRaw,
        installed: Boolean(l && l.installed),
        same,
        known: Boolean(l),
        action: !l || !l.installed ? 'install' : (same ? 'skip' : 'conflict'),
      }
    })
    for (const x of A.tools) {
      if (x.installed && !manifest.tools.find((m) => m.id === x.id)) {
        items.push({ id: x.id, name: x.name, want: '', has: x.version || '',
          installed: true, same: false, known: true, extra: true, action: 'extra' })
      }
    }

    return { ok: true, manifest, items, viaServer,
      stats: {
        install: items.filter((i) => i.action === 'install').length,
        skip: items.filter((i) => i.action === 'skip').length,
        conflict: items.filter((i) => i.action === 'conflict').length,
        extra: items.filter((i) => i.action === 'extra').length,
      } }
  })

  // ---------- 预设包展开 ----------
  route('/pack', async (req) => {
    const b = await readBody(req)
    return { ok: true, id: b.id, tools: expandPack(b.id) }
  })

  // 安装进度
  route('/progress', async (req) => {
    const u = new URL(req.url, 'http://x')
    const id = u.searchParams.get('id') || ''
    return { ok: true, id, progress: getProg(id) }
  })
  // 弹原生文件夹选择框
  route('/pickfolder', async (req) => {
    const b = await readBody(req)
    log.info?.('打开文件夹选择框…')
    return pickFolder(b.start || cfg().root)
  })
  // 用资源管理器打开目录（不存在就先建）
  route('/opendir', async (req) => {
    const b = await readBody(req)
    let dir = (b.dir && String(b.dir).trim()) || cfg().root
    dir = dir.replace(/[\\/]+$/, '')
    if (!existsSync(dir)) {
      try { mkdirSync(dir, { recursive: true }) } catch (e) {
        return { ok: false, message: '目录不存在且创建失败：' + (e.message || e) }
      }
    }
    try {
      // explorer 常以非 0 退出，detached 不等它
      spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref()
      log.info?.('打开目录 ' + dir)
      return { ok: true, message: '已打开 ' + dir }
    } catch (e) {
      return { ok: false, message: '打开失败：' + (e.message || e) }
    }
  })
  route('/uninstall', async (req) => uninstall((await readBody(req)).id))
  route('/fixpath', async (req) => fixPath((await readBody(req)).ids))
  route('/bat', async (req) => {
    const C = cfg()
    try {
      mkdirSync(C.root, { recursive: true })
      const f = join(C.root, 'add-to-path.bat')
      writeFileSync(f, genBat(), 'utf8')
      return { ok: true, message: '已生成', path: f }
    } catch (e) { return { ok: false, message: String(e.message || e) } }
  })

  ctx.effect(() => {
    const C = cfg()
    log.info?.('环境体检已加载 · 安装目录 ' + C.root)
  }, 'envdoctor: 初始化')
}
