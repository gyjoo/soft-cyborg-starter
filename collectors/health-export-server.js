// Health Auto Export(iOS 앱) 의 "REST API" 자동 내보내기를 받는 수신 엔드포인트.
// 앱 설정: Automations → REST API → URL http://<맥 주소>:8787/health, 형식 JSON, 집계 단위 Days, 헤더 X-Health-Key: <HEALTH_KEY 값>.
// 받은 지표를 날짜별로 합쳐 MEMORY_DIR/health/YYYY-MM-DD.json 에 저장한다. 같은 날 재전송은 덮어쓴다(유실·중복 없음).
//   실행: MEMORY_DIR=../memory-template HEALTH_KEY=<아무 긴 문자열> node collectors/health-export-server.js
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.PORT ?? 8787)
const KEY = process.env.HEALTH_KEY ?? ''
const DIR = path.join(path.resolve(process.env.MEMORY_DIR ?? '../memory-template'), 'health')
if (!KEY) { console.error('[health] HEALTH_KEY 를 정하세요 (폰 앱 헤더와 같은 값). 아무 긴 문자열이면 됩니다.'); process.exit(1) }
mkdirSync(DIR, { recursive: true })

const dayOf = (s) => String(s).slice(0, 10) // "2026-01-15 00:00:00 +0900" → "2026-01-15"

function merge(payload) {
  const days = {}
  const bucket = (d) => (days[d] ??= existsSync(path.join(DIR, `${d}.json`)) ? JSON.parse(readFileSync(path.join(DIR, `${d}.json`), 'utf8')) : { metrics: {}, workouts: [] })
  for (const m of payload?.data?.metrics ?? []) {
    for (const p of m.data ?? []) {
      const b = bucket(dayOf(p.date))
      // 수면처럼 여러 필드가 있는 지표는 전체를, 단순 지표는 qty 만 (단위 포함)
      b.metrics[m.name] = { units: m.units, ...(p.qty !== undefined ? { qty: p.qty } : p) }
    }
  }
  for (const w of payload?.data?.workouts ?? []) {
    const b = bucket(dayOf(w.start))
    b.workouts = b.workouts.filter((x) => x.start !== w.start).concat([{ name: w.name, start: w.start, end: w.end, distance: w.distance, energy: w.activeEnergyBurned }])
  }
  for (const [d, b] of Object.entries(days)) writeFileSync(path.join(DIR, `${d}.json`), JSON.stringify(b, null, 1))
  return Object.keys(days)
}

createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/health') { res.writeHead(404); return res.end() }
  if (req.headers['x-health-key'] !== KEY) { res.writeHead(401); return res.end('bad key') }
  let body = ''
  req.on('data', (c) => { body += c; if (body.length > 20_000_000) req.destroy() })
  req.on('end', () => {
    try {
      const days = merge(JSON.parse(body))
      console.log(`[health] ${new Date().toISOString()} 저장: ${days.join(', ')}`)
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, days }))
    } catch (e) {
      console.error('[health] 파싱 실패', e.message); res.writeHead(400); res.end('bad json')
    }
  })
}).listen(PORT, () => console.log(`[health] http://0.0.0.0:${PORT}/health 대기 중 → ${DIR}`))
