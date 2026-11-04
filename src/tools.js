// 工具定义加载器：从 data/tools.json 读取，安装根目录由参数传入
// 加新工具只需编辑 data/tools.json，不用改代码
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, '..', 'data')

function readJson(name, fallback) {
  try {
    return JSON.parse(readFileSync(join(DATA, name), 'utf8'))
  } catch (e) {
    console.error(`[envdoctor] 读取 ${name} 失败: ${e.message}`)
    return fallback
  }
}

/** 原始定义（模块加载时读一次；改文件后需重启 DSH） */
export const RAW_TOOLS = readJson('tools.json', [])
export const PACKS = readJson('packs.json', [])

/** 扫描用的候选 exe 名（与根目录无关，给 scan.js 用） */
export const EXE_NAMES = [...new Set(
  RAW_TOOLS.map((t) => t.exe).filter(Boolean)
)]

function joinParts(a, ...rest) {
  let s = String(a).replace(/[\\/]+$/, '')
  for (const r of rest) {
    s += '\\' + String(r).replace(/^[\\/]+|[\\/]+$/g, '')
  }
  return s
}

/** 把 {root} / {target} 占位换掉 */
function subst(str, R, target) {
  if (!str) return str
  return String(str)
    .replace(/\{root\}/g, R)
    .replace(/\{target\}/g, target || '')
}

/** 根据安装根目录生成工具清单 */
export function toolsFor(root) {
  const R = String(root || join(process.env.SystemDrive || 'C:', 'tools')).replace(/[\\/]+$/, '')

  return RAW_TOOLS.map((raw) => {
    const target = subst(raw.target, R) || joinParts(R, raw.id)
    const bindirs = (raw.bindir && raw.bindir.length ? raw.bindir : [target])
      .map((d) => subst(d, R, target))
    // Windows 常见安装位置也算候选，方便识别已装的
    const common = {
      '7zip': [join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip')],
      'python': [
        join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312'),
        join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311'),
      ],
      'node': [join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs')],
      'git': [join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd'),
              join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin')],
      'chrome': [join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application'),
                 join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application')],
      'jdk21': [join(process.env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium', 'jdk-21'),],
      'jdk17': [join(process.env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium', 'jdk-17'),],
      'mysql': [join(process.env.ProgramFiles || 'C:\\Program Files', 'MySQL', 'MySQL Server 8.4')],
      'postgres': [join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL', '16')],
      'redis': [join(process.env.ProgramFiles || 'C:\\Program Files', 'Redis')],
      'gh': [join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI')],
      'imagemagick': [join(process.env.ProgramFiles || 'C:\\Program Files', 'ImageMagick-7.1.1-Q16-HDRI')],
      'pandoc': [join(process.env.LOCALAPPDATA || '', 'Pandoc')],
    }[raw.id] || []

    const allBindirs = [...new Set([
      ...bindirs.map((d) => d.replace(/[\\/]+$/, '')),
      ...common.map((d) => d.replace(/[\\/]+$/, '')).filter(Boolean),
    ])]

    return {
      id: raw.id,
      name: raw.name,
      category: raw.category || '其他',
      desc: raw.desc || '',
      exe: raw.exe || null,
      prefer: raw.prefer || null,
      stable: (raw.versions && raw.versions.stable) || 'latest',
      versions: (raw.versions && raw.versions.presets) || null,
      kind: raw.kind || 'zip',
      strip: raw.strip ?? 0,
      target,
      note: raw.note || '',
      installArgs: (raw.installArgs || []).map((a) => subst(a, R, target)),
      dlNameHint: raw.resolve && raw.resolve.dlName ? subst(raw.resolve.dlName, R, target) : '',
      bindir() { return allBindirs },
      /** 解析出下载信息；mode: stable | latest | custom */
      resolve(mode, custom) {
        const res = raw.resolve
        if (!res) return null
        const v = mode === 'stable' ? this.stable
          : mode === 'latest' ? this.stable
            : (custom || this.stable)
        const out = {
          type: res.type,
          label: `${this.name} ${v}`,
          version: v,
          dlName: res.dlName ? subst(res.dlName, R, target) : '',
          stripDirPrefix: res.stripDirPrefix || '',
        }
        if (res.type === 'url') {
          out.url = res.url.replace(/\{v\}/g, v)
        } else if (res.type === 'github') {
          out.gh = {
            repo: res.repo,
            asset: String(res.asset || '').replace(/\{v\}/g, v),
            version: (res.tag === '' ? '' : String(res.tag || '{v}').replace(/\{v\}/g, v)),
          }
        } else if (res.type === 'special') {
          out.handler = res.handler
        }
        return out
      },
      /** 查最新版本号（仅部分工具有） */
      async latest() { return this.stable },
    }
  })
}

/** 展开预设包（支持嵌套引用） */
export function expandPack(packId, seen = new Set()) {
  const out = []
  const walk = (id) => {
    if (seen.has(id)) return
    seen.add(id)
    const p = PACKS.find((x) => x.id === id)
    if (!p) {
      // 不是包，当工具 id
      if (!out.includes(id)) out.push(id)
      return
    }
    for (const x of p.tools) walk(x)
  }
  walk(packId)
  return out
}
