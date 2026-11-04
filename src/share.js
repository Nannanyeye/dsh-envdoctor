// 环境清单分享：编码/解码 + 可选口令加密 + Ed25519 签名
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv,
  generateKeyPairSync, sign as edSign, verify as edVerify, createHash } from 'node:crypto'

const TAG = 'ENV1'      // 明文
const TAG_ENC = 'ENV1E' // 口令加密
const TAG_SIG = 'ENV1S' // 带签名（明文 + sig）

const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

/** 精简清单：只留工具 id + 版本，尽量短 */
export function compacto(manifest) {
  return {
    n: manifest.name || '',
    a: manifest.author || '',
    r: manifest.root || '',
    t: (manifest.tools || []).map((t) => [t.id, t.version || '']),
    c: manifest.createdAt || '',
  }
}

/** 还原成可读清单 */
export function expandir(c) {
  return {
    name: c.n || '未命名环境',
    author: c.a || '',
    root: c.r || '',
    createdAt: c.c || '',
    tools: (c.t || []).map(([id, version]) => ({ id, version })),
  }
}

// ---------- 口令加密 ----------
function derive(pass, salt) {
  return pbkdf2Sync(String(pass), salt, 100000, 32, 'sha256')
}

function encrypt(raw, pass) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = derive(pass, salt)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([c.update(raw), c.final()])
  return Buffer.concat([salt, iv, c.getAuthTag(), body])
}

function decrypt(buf, pass) {
  const salt = buf.subarray(0, 16)
  const iv = buf.subarray(16, 28)
  const tag = buf.subarray(28, 44)
  const body = buf.subarray(44)
  const key = derive(pass, salt)
  const d = createDecipheriv('aes-256-gcm', key, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(body), d.final()])
}

// ---------- 编码 ----------
/** @param manifest 完整清单 @param pass 口令（可空） */
export function encodeShare(manifest, pass) {
  const json = Buffer.from(JSON.stringify(compacto(manifest)), 'utf8')
  const zip = deflateRawSync(json, { level: 9 })

  if (pass) {
    const enc = encrypt(zip, pass)
    return { code: `${TAG_ENC}.${b64u(enc)}`, encrypted: true, bytes: enc.length }
  }
  return { code: `${TAG}.${b64u(zip)}`, encrypted: false, bytes: zip.length }
}

/** 解析分享码；加密的必须给 pass */
export function decodeShare(code, pass) {
  const s = String(code || '').trim().replace(/\s+/g, '')
  const dot = s.indexOf('.')
  if (dot < 0) throw new Error('分享码格式不对（缺少 . 分隔）')
  const tag = s.slice(0, dot).toUpperCase()
  const payload = unb64u(s.slice(dot + 1))

  let zip
  if (tag === TAG || tag === TAG_SIG) zip = payload
  else if (tag === TAG_ENC) {
    if (!pass) throw new Error('这个码加密了，需要口令')
    try { zip = decrypt(payload, pass) } catch { throw new Error('口令不对，或码已损坏') }
  } else throw new Error('不认识的分享码类型：' + tag)

  let obj
  try { obj = JSON.parse(inflateRawSync(zip).toString('utf8')) } catch { throw new Error('分享码内容损坏') }
  return expandir(obj)
}

// ---------- Ed25519 签名 ----------
export function genKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

export function fingerprint(publicKeyPem) {
  return createHash('sha256').update(String(publicKeyPem)).digest('hex').slice(0, 16)
}

/** 对清单签名，返回 ENV1S 码 */
export function encodeSigned(manifest, privateKeyPem) {
  const json = Buffer.from(JSON.stringify(compacto(manifest)), 'utf8')
  const zip = deflateRawSync(json, { level: 9 })
  const sig = edSign(null, zip, privateKeyPem)
  return { code: `${TAG_SIG}.${b64u(Buffer.concat([sig, zip]))}` }
}

/** 验签并解析 */
export function decodeSigned(code, publicKeyPem) {
  const s = String(code || '').trim()
  const dot = s.indexOf('.')
  if (dot < 0 || s.slice(0, dot).toUpperCase() !== TAG_SIG) throw new Error('不是签名码')
  const buf = unb64u(s.slice(dot + 1))
  const sig = buf.subarray(0, 64)
  const zip = buf.subarray(64)
  const ok = edVerify(null, zip, publicKeyPem, sig)
  if (!ok) throw new Error('签名校验失败：这份清单不是该公钥签发的，或被改过')
  return { manifest: expandir(JSON.parse(inflateRawSync(zip).toString('utf8'))), verified: true }
}
