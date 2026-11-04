// 插件设置：安装根目录等，存 ~/.dsh/plugins-data/envdoctor/settings.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const FILE = () =>
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'plugins-data', 'envdoctor', 'settings.json')

/** 自动选根目录：优先 D:\tools，其次 E:，再 C:\tools，最后用户目录 */
export function pickDefaultRoot() {
  const cands = ['D:\\tools', 'E:\\tools', 'C:\\tools', join(homedir(), 'tools')]
  for (const c of cands) {
    const drive = c.slice(0, 3) // 例如 "D:\"
    try { if (existsSync(drive)) return c } catch {}
  }
  return join(homedir(), 'tools')
}

/** 默认分享短码服务（自建，见 share-server/） */
export const DEFAULT_SHARE_SERVER = 'https://ifhaoyi.xyz'

export function loadSettings() {
  let d = {}
  try { d = JSON.parse(readFileSync(FILE(), 'utf8')) || {} } catch {}
  let root = d.root && String(d.root).trim()
  if (!root) root = pickDefaultRoot()
  root = root.replace(/[\\/]+$/, '')
  const shareServer = (d.shareServer === undefined ? DEFAULT_SHARE_SERVER : String(d.shareServer || '')).trim().replace(/\/+$/, '')
  return {
    ...d,
    root,
    shareServer,
    defaults: { root: pickDefaultRoot(), shareServer: DEFAULT_SHARE_SERVER },
    settingsPath: FILE(),
  }
}

export function saveSettings(patch) {
  const cur = loadSettings()
  const next = { ...cur, ...patch }
  delete next.defaults
  delete next.settingsPath
  if (next.root) next.root = String(next.root).trim().replace(/[\\/]+$/, '')
  if (next.shareServer !== undefined) {
    next.shareServer = String(next.shareServer || '').trim().replace(/\/+$/, '')
  }
  mkdirSync(dirname(FILE()), { recursive: true })
  writeFileSync(FILE(), JSON.stringify(next, null, 2), 'utf8')
  return loadSettings()
}
