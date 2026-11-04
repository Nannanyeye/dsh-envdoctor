// 环境体检 · 网页半边
window.__ModuleLoader__.load({
  id: 'dsh-envdoctor',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const { useState, useEffect, useCallback } = React
    const h = React.createElement
    const inject = ['slots']
    const PANEL_ID = 'envdoctor'
    const API = '/envdoctor/api'

    const get = (p) => fetch(API + p, { cache: 'no-store' }).then((r) => r.json()).catch((e) => ({ ok: false, message: String(e) }))
    const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json()).catch((e) => ({ ok: false, message: String(e) }))

    const ELL = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }

    const S = {
      page: { height: '100%', overflow: 'auto', padding: '16px 20px', fontSize: 13,
        color: 'var(--dsw-alias-label-primary,#111)', background: 'var(--dsw-alias-bg-module-platform,#fafafa)' },
      card: { background: 'var(--dsw-alias-bg-layer-1,#fff)',
        border: '1px solid var(--dsw-alias-border-l2,#e5e5e5)', borderRadius: 9,
        padding: '12px 14px', marginBottom: 12 },
      row: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      btn: (k) => ({ padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12.5,
        flex: '0 0 auto', whiteSpace: 'nowrap',
        border: '1px solid var(--dsw-alias-border-l2,#ddd)',
        background: k === 'primary' ? 'var(--dsw-alias-button-primary-fill,#0f1115)' : 'transparent',
        color: k === 'primary' ? 'var(--dsw-alias-label-primary-foreground,#fff)' : 'inherit' }),
      muted: { color: 'var(--dsw-alias-label-secondary,#666)', fontSize: 12 },
      mono: { fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 11.5 },
      pill: (c) => ({ padding: '1px 7px', borderRadius: 9, fontSize: 11, flex: '0 0 auto',
        background: c === 'ok' ? 'rgba(34,197,94,.14)' : c === 'warn' ? 'rgba(245,158,11,.16)' : 'rgba(156,163,175,.16)',
        color: c === 'ok' ? '#15803d' : c === 'warn' ? '#b45309' : '#6b7280' }),
      sel: { padding: '3px 6px', borderRadius: 6, fontSize: 12, flex: '0 0 auto',
        border: '1px solid var(--dsw-alias-border-l2,#ddd)', background: 'transparent', color: 'inherit' },
      inp: { padding: '3px 7px', borderRadius: 6, fontSize: 12,
        border: '1px solid var(--dsw-alias-border-l2,#ddd)', background: 'transparent', color: 'inherit' },
    }

    const mb = (n) => n ? (n / 1048576).toFixed(1) + ' MB' : ''

    function stageText(p) {
      if (!p) return '准备…'
      const s = p.stage
      if (s === 'prep') return p.text || '准备'
      if (s === 'download') {
        if (p.total) return `下载 ${mb(p.done)} / ${mb(p.total)}`
        return p.done ? `下载 ${mb(p.done)}` : '连接中…'
      }
      if (s === 'extract') return '解压中…'
      if (s === 'copy') return '复制文件…'
      if (s === 'verify') return '校验…'
      if (s === 'done') return '完成'
      if (s === 'fail') return '失败：' + (p.error || '未知')
      return s
    }

    function Bar({ pct, kind }) {
      return h('div', { style: { flex: '1 1 auto', height: 5, borderRadius: 3, overflow: 'hidden',
        background: 'var(--dsw-alias-border-l2,#e5e5e5)', minWidth: 80 } },
        h('div', { style: { width: (pct || 0) + '%', height: '100%', transition: 'width .25s',
          background: kind === 'fail' ? '#dc2626' : kind === 'done' ? '#22c55e' : '#3b82f6' } }))
    }

    function Row({ t, busy, onInstall, onUninstall }) {
      const [mode, setMode] = useState('stable')
      const [ver, setVer] = useState('')
      const [open, setOpen] = useState(false)
      const [prog, setProg] = useState(null)
      const working = busy === t.id

      useEffect(() => {
        if (!working) { setProg(null); return }
        let alive = true
        const tick = async () => {
          const r = await get('/progress?id=' + encodeURIComponent(t.id))
          if (alive) setProg(r.progress)
        }
        tick()
        const iv = setInterval(tick, 400)
        return () => { alive = false; clearInterval(iv) }
      }, [working, t.id])

      const st = t.installed ? (t.needPath ? 'warn' : 'ok') : 'none'
      const label = t.installed ? (t.needPath ? '缺PATH' : '就绪') : '未装'
      const pct = prog ? prog.pct : 0
      const kind = prog && prog.stage === 'fail' ? 'fail' : prog && prog.stage === 'done' ? 'done' : ''

      // 打开这个 exe 所在目录
      const dirOf = (p) => {
        if (!p) return ''
        const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
        return i > 0 ? p.slice(0, i) : ''
      }
      const openThis = async () => {
        const d = dirOf(t.path)
        if (!d) return
        const r = await post('/opendir', { dir: d })
        if (!r.ok) alert(r.message || '打开失败')
      }

      return h('div', { style: { padding: '9px 0', borderBottom: '1px solid var(--dsw-alias-border-l1,#f4f4f4)' } },
        h('div', { style: { ...S.row, justifyContent: 'space-between', flexWrap: 'nowrap' } },
          h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            h('div', { style: { ...S.row, gap: 7, flexWrap: 'nowrap' } },
              h('span', { style: { fontWeight: 550, flex: '0 0 auto' } }, t.name),
              h('span', { style: S.pill(st) }, label),
              t.version
                ? h('span', { style: { ...S.mono, ...S.muted, ...ELL, maxWidth: 240 } }, t.version)
                : null,
              t.candidates && t.candidates.length > 1
                ? h('button', { style: { ...S.btn(), padding: '0 6px', fontSize: 11, flex: '0 0 auto' },
                    onClick: () => setOpen(!open) }, t.candidates.length + ' 处')
                : null,
              t.installed && t.path
                ? h('button', { style: { ...S.btn(), padding: '0 6px', fontSize: 11, flex: '0 0 auto' },
                    title: dirOf(t.path), onClick: openThis }, '打开')
                : null),
            h('div', { style: { ...S.mono, ...S.muted, ...ELL, marginTop: 2 } },
              t.path || t.desc)),
          h('div', { style: { ...S.row, gap: 6, flex: '0 0 auto' } },
            working ? h('span', { style: { ...S.muted, whiteSpace: 'nowrap', ...S.mono } },
                prog ? pct + '%' : '…')
              : t.installed
                ? h('button', { style: S.btn(), onClick: () => onUninstall(t) }, '卸载')
                : !t.installable
                  ? h('span', { style: { ...S.muted, maxWidth: 150, ...ELL } }, t.note || '需手动')
                  : h(React.Fragment, null,
                      h('select', { style: S.sel, value: mode, onChange: (e) => setMode(e.target.value) },
                        h('option', { value: 'stable' }, '稳定 ' + t.versions.stable),
                        t.versions.presets
                          ? t.versions.presets.map((v) => h('option', { key: v, value: 'custom:' + v }, v))
                          : null,
                        t.versions.hasLatest ? h('option', { value: 'latest' }, '最新') : null,
                        t.versions.presets ? null : h('option', { value: 'custom' }, '指定')),
                      mode === 'custom'
                        ? h('input', { style: { ...S.inp, width: 84 }, placeholder: '版本号', value: ver,
                            onChange: (e) => setVer(e.target.value) })
                        : null,
                      h('button', { style: S.btn('primary'),
                        onClick: () => onInstall(t,
                          mode.indexOf('custom:') === 0 ? 'custom' : mode,
                          mode.indexOf('custom:') === 0 ? mode.slice(7) : ver) }, '安装')))),

        // 进度条
        working ? h('div', { style: { ...S.row, gap: 8, marginTop: 6 } },
          h(Bar, { pct, kind }),
          h('span', { style: { ...S.mono, ...S.muted, flex: '0 0 auto', whiteSpace: 'nowrap' } },
            stageText(prog))) : null,


        open ? h('div', { style: { marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--dsw-alias-border-l1,#eee)' } },
          t.candidates.map((c, i) => h('div', { key: i, style: { ...S.mono, ...S.muted, ...ELL, padding: '1px 0' } },
            (i === 0 ? '\u2605 ' : '  ') + c))) : null)
    }

    function EnvDoctorPage() {
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState('')
      const [msg, setMsg] = useState(null)
      const [rootDraft, setRootDraft] = useState('')
      const [shareName, setShareName] = useState('我的环境')
      const [sharePass, setSharePass] = useState('')
      const [shareOut, setShareOut] = useState(null)
      const [impCode, setImpCode] = useState('')
      const [impPass, setImpPass] = useState('')
      const [diff, setDiff] = useState(null)
      const [picked, setPicked] = useState([])

      const scan = useCallback(async (force) => {
        if (force) setBusy('scan')
        const d = await get('/audit' + (force ? '?scan=1' : ''))
        setData(d)
        if (force) setBusy('')
      }, [])
      useEffect(() => { scan(false) }, [scan])
      useEffect(() => { if (data && data.root) setRootDraft(data.root) }, [data])

      const toast = (t, kind) => { setMsg({ t, kind }); setTimeout(() => setMsg(null), 6000) }

      // ---------- 分享 ----------
      const doExport = async (upload) => {
        setBusy('share')
        setShareOut(null)
        const r = await post('/share/export', { name: shareName, pass: sharePass, upload })
        setBusy('')
        if (!r.ok) { toast(r.message || '导出失败', 'bad'); return }
        setShareOut(r)
        if (upload && r.shortCode) toast('短码 ' + r.shortCode, 'ok')
        else if (upload && r.uploadErr) toast('短码生成失败：' + r.uploadErr, 'bad')
        else if (!upload) toast('已生成分享码（' + r.count + ' 个工具）', 'ok')
      }

      const doImport = async () => {
        const code = (impCode || '').trim()
        if (!code) { toast('先粘贴分享码', 'bad'); return }
        setBusy('import')
        const r = await post('/share/import', { code, pass: impPass })
        setBusy('')
        if (!r.ok) { setDiff(null); toast(r.message || '解析失败', 'bad'); return }
        setDiff(r)
        toast('解析成功：' + r.items.length + ' 项', 'ok')
      }

      const applyAll = async () => {
        if (!diff) return
        const todo = diff.items.filter((i) => i.action === 'install' || i.action === 'conflict')
        if (!todo.length) { toast('没有需要安装的', 'ok'); return }
        setBusy('apply')
        let okN = 0, badN = 0
        for (const it of todo) {
          const r = await post('/install', { id: it.id, mode: 'custom', version: it.want })
          if (r.ok) okN++; else badN++
        }
        setBusy('')
        toast(`安装完成：成功 ${okN}，失败 ${badN}`, badN ? 'bad' : 'ok')
        scan(false)
      }

      const copyText = async (s) => {
        try { await navigator.clipboard.writeText(s); toast('已复制', 'ok') }
        catch { toast('复制失败，请手动选中', 'bad') }
      }

      const usePack = (pack) => {
        if (!data || !data.packs) return
        const ids = []
        const walk = (id) => {
          const p = data.packs.find((x) => x.id === id)
          if (!p) { if (!ids.includes(id)) ids.push(id); return }
          for (const x of p.tools) walk(x)
        }
        walk(pack.id)
        setPicked(ids)
        toast('已选「' + pack.name + '」共 ' + ids.length + ' 个工具', 'ok')
      }

      // 用资源管理器打开当前目录
      const openDir = async () => {
        const dir = (rootDraft || (data && data.root) || '').trim()
        if (!dir) { toast('目录为空', 'bad'); return }
        const r = await post('/opendir', { dir })
        if (!r.ok) toast(r.message || '打开失败', 'bad')
      }

      const doInstall = async (t, mode, version) => {
        setBusy(t.id)
        toast(`安装 ${t.name} …`, 'info')
        const r = await post('/install', { id: t.id, mode, version })
        setBusy('')
        toast(r.message || (r.ok ? '完成' : '失败'), r.ok ? 'ok' : 'bad')
        scan(false)
      }
      const doUninstall = async (t) => {
        if (!confirm(`删除 ${t.name}？`)) return
        setBusy(t.id)
        const r = await post('/uninstall', { id: t.id })
        setBusy('')
        toast(r.message || '完成', r.ok ? 'ok' : 'bad')
        scan(false)
      }
      const fixPath = async () => {
        setBusy('path')
        const r = await post('/fixpath', {})
        setBusy('')
        toast(r.message || '完成', r.ok ? 'ok' : 'bad')
        scan(false)
      }
      const genBat = async () => {
        const r = await post('/bat', {})
        toast(r.ok ? '已生成 ' + r.path : r.message, r.ok ? 'ok' : 'bad')
      }
      const saveRoot = async () => {
        const v = (rootDraft || '').trim()
        if (!v) { toast('目录不能为空', 'bad'); return }
        setBusy('root')
        const r = await post('/settings', { root: v })
        setBusy('')
        toast(r.message || (r.ok ? '已保存' : '失败'), r.ok ? 'ok' : 'bad')
        scan(true)
      }
      const pickFolder = async () => {
        setBusy('pick')
        try {
          const r = await post('/pickfolder', { start: rootDraft || (data && data.root) || '' })
          setBusy('')
          if (r.ok && r.path) { setRootDraft(r.path); toast('已选 ' + r.path, 'ok') }
          else toast(r.canceled ? '已取消' : (r.message || '没选到'), 'bad')
        } catch (e) { setBusy(''); toast('打开失败：' + e, 'bad') }
      }

      if (!data) return h('div', { style: S.page }, '扫描中…')
      const list = data.tools || []
      const ok = list.filter((t) => t.installed && !t.needPath).length
      const needPath = list.filter((t) => t.needPath).length
      const missing = list.filter((t) => !t.installed).length
      const groups = {}
      for (const t of list) (groups[t.category] = groups[t.category] || []).push(t)

      // ---------- 预设包 ----------
      const packRow = (data.packs && data.packs.length)
        ? h('div', { style: { ...S.card, padding: '10px 14px' } },
            h('div', { style: { ...S.row, gap: 6, flexWrap: 'wrap' } },
              h('span', { style: { ...S.muted, flex: '0 0 auto', marginRight: 4 } }, '预设'),
              ...data.packs.map((pk) => h('button', {
                key: pk.id,
                style: { ...S.btn(), fontSize: 12, padding: '3px 10px' },
                title: pk.desc || '',
                onClick: () => usePack(pk),
              }, pk.name))),
            picked.length
              ? h('div', { style: { ...S.mono, ...S.muted, ...ELL, marginTop: 6 } },
                  '已选 ' + picked.length + ' 个：' + picked.join(', '))
              : null)
        : null

      // ---------- 分享 ----------
      const ACT = {
        install: ['待装', 'none'], skip: ['已一致', 'ok'],
        conflict: ['版本不同', 'warn'], extra: ['本地多出', 'warn'],
      }
      const diffRows = diff
        ? diff.items.map((it) => {
            const [label, kind] = ACT[it.action] || ['?', 'none']
            return h('div', { key: it.id + it.action, style: { ...S.row,
                justifyContent: 'space-between', padding: '5px 0',
                borderBottom: '1px solid var(--dsw-alias-border-l1,#f4f4f4)' } },
              h('div', { style: { ...S.row, gap: 7, minWidth: 0 } },
                h('span', { style: { fontWeight: 550, flex: '0 0 auto' } }, it.name),
                h('span', { style: S.pill(kind) }, label)),
              h('div', { style: { ...S.mono, ...S.muted, ...ELL, flex: '0 0 auto', maxWidth: 320 } },
                (it.want ? '清单 ' + it.want : '—') + '　本地 ' + (it.has || '无')))
          })
        : null

      const shareCard = h('div', { style: S.card },
        // 导出
        h('div', { style: { ...S.row, flexWrap: 'nowrap', marginBottom: 8 } },
          h('span', { style: { ...S.muted, flex: '0 0 auto', width: 56 } }, '分享'),
          h('input', { style: { ...S.inp, flex: '0 0 150px' }, value: shareName,
            placeholder: '环境名称', onChange: (e) => setShareName(e.target.value) }),
          h('input', { style: { ...S.inp, flex: '0 0 120px' }, value: sharePass, type: 'password',
            placeholder: '口令(可空)', onChange: (e) => setSharePass(e.target.value) }),
          h('button', { style: S.btn(), onClick: () => doExport(false), disabled: !!busy },
            busy === 'share' ? '…' : '生成长码'),
          h('button', { style: S.btn('primary'), onClick: () => doExport(true), disabled: !!busy || !data.shareServer },
            '生成短码')),

        // 输出
        shareOut
          ? h('div', { style: { marginBottom: 10 } },
              h('div', { style: { ...S.row, flexWrap: 'nowrap', marginBottom: 4 } },
                h('span', { style: { ...S.muted } },
                  shareOut.shortCode ? '短码（8 位，对方直接粘贴）' : '长码'),
                shareOut.shortCode
                  ? h('span', { style: { ...S.mono, fontWeight: 600, fontSize: 15, marginLeft: 8 } }, shareOut.shortCode)
                  : null,
                h('button', { style: { ...S.mini, marginLeft: 8 },
                  onClick: () => copyText(shareOut.shortCode || shareOut.code) }, '复制')),
              h('div', { style: { ...S.mono, ...S.muted, ...ELL, fontSize: 10.5 } }, shareOut.code),
              shareOut.uploadErr
                ? h('div', { style: { color: '#b45309', fontSize: 11.5, marginTop: 3 } },
                    '短码失败：' + shareOut.uploadErr)
                : null)
          : null,

        // 导入
        h('div', { style: { ...S.row, flexWrap: 'nowrap', marginTop: shareOut ? 4 : 8 } },
          h('span', { style: { ...S.muted, flex: '0 0 auto', width: 56 } }, '导入'),
          h('input', { style: { ...S.inp, ...S.mono, flex: '1 1 auto', minWidth: 0 }, value: impCode,
            placeholder: '粘贴分享码，或 8 位短码（如 A7K2M9XQ）',
            onChange: (e) => setImpCode(e.target.value) }),
          h('input', { style: { ...S.inp, flex: '0 0 100px' }, value: impPass, type: 'password',
            placeholder: '口令', onChange: (e) => setImpPass(e.target.value) }),
          h('button', { style: S.btn('primary'), onClick: doImport, disabled: !!busy },
            busy === 'import' ? '解析中…' : '解析')),

        // 对比
        diff
          ? h('div', { style: { marginTop: 10 } },
              h('div', { style: { ...S.muted, marginBottom: 4 } },
                '「' + diff.manifest.name + '」 ' + diff.items.length + ' 项　' +
                (diff.stats.install ? '待装 ' + diff.stats.install + '　' : '') +
                (diff.stats.skip ? '已一致 ' + diff.stats.skip + '　' : '') +
                (diff.stats.conflict ? '版本不同 ' + diff.stats.conflict + '　' : '') +
                (diff.stats.extra ? '本地多出 ' + diff.stats.extra : '')),
              diffRows,
              h('div', { style: { ...S.row, justifyContent: 'flex-end', gap: 8, marginTop: 8 } },
                h('button', { style: S.btn(), onClick: () => setDiff(null) }, '关闭'),
                h('button', { style: S.btn('primary'), onClick: applyAll, disabled: !!busy },
                  busy === 'apply' ? '安装中…' : '按清单安装')))
          : null)

      return h('div', { style: S.page },
        // 顶栏
        h('div', { style: { ...S.row, justifyContent: 'space-between', marginBottom: 12, flexWrap: 'nowrap' } },
          h('div', { style: { ...S.row, gap: 10, minWidth: 0 } },
            h('span', { style: { fontSize: 16, fontWeight: 600, flex: '0 0 auto' } }, '环境体检'),
            h('span', { style: { ...S.muted, flex: '0 0 auto' } },
              `${ok} 就绪 / ${needPath} 缺PATH / ${missing} 缺失`),
            h('span', { style: { ...S.mono, ...S.muted, ...ELL, maxWidth: 320 } }, data.root)),
          h('div', { style: { ...S.row, gap: 6, flex: '0 0 auto' } },
            h('button', { style: S.btn('primary'), onClick: fixPath, disabled: !!busy },
              busy === 'path' ? '…' : '修 PATH'),
            h('button', { style: S.btn(), onClick: genBat }, '生成 bat'),
            h('button', { style: S.btn('primary'), onClick: () => scan(true), disabled: !!busy },
              busy === 'scan' ? '扫描中…' : '全盘体检'))),

        // 安装目录
        h('div', { style: S.card },
          h('div', { style: { ...S.row, flexWrap: 'nowrap' } },
            h('span', { style: { ...S.muted, flex: '0 0 auto' } }, '安装目录'),
            h('input', { style: { ...S.inp, ...S.mono, flex: '1 1 auto', minWidth: 0 },
              value: rootDraft, placeholder: data.defaults,
              onChange: (e) => setRootDraft(e.target.value) }),
            h('button', { style: S.btn('primary'), onClick: pickFolder, disabled: !!busy },
              busy === 'pick' ? '等待…' : '浏览…'),
            h('button', { style: S.btn(), onClick: openDir }, '打开'),
            h('button', { style: S.btn(), onClick: saveRoot, disabled: !!busy }, '保存'),
            h('button', { style: S.btn(), onClick: () => setRootDraft(data.defaults) }, '默认'))),

        shareCard,
        packRow,

        // 工具分组
        Object.entries(groups).map(([cat, items]) =>
          h('div', { key: cat, style: S.card },
            h('div', { style: { ...S.muted, fontWeight: 600, marginBottom: 2 } }, cat),
            items.map((t) => h(Row, { key: t.id, t, busy, onInstall: doInstall, onUninstall: doUninstall })))),

        msg ? h('div', { style: { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          padding: '8px 18px', borderRadius: 7, zIndex: 9999, color: '#fff', maxWidth: 560, ...ELL,
          background: msg.kind === 'bad' ? '#dc2626' : 'var(--dsw-alias-button-primary-fill,#0f1115)' } }, msg.t) : null)
    }

    function BoxIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: 'M21 8v13H3V8' }), h('path', { d: 'M1 3h22v5H1z' }), h('path', { d: 'M10 12h4' }))
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, EnvDoctorPage))
      slots.inject('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist', id: PANEL_ID, order: 22, label: () => '环境体检' }, BoxIcon))
    }

    exports.apply = apply
    exports.inject = inject
    exports.EnvDoctorPage = EnvDoctorPage
    return module.exports
  },
})
