// soft-cyborg bridge — Slack DM 을 받아 기억 레포에서 `claude -p` 를 돌리고 답장한다.
// 설계 원칙: 한 번에 한 턴(동시성 1), 채널별 세션 유지(--resume), 타임아웃이면 죽이고 사과, 원문 로그는 chat/ 에.
import { App } from '@slack/bolt'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// ── 0. 설정 검사: 빠진 게 있으면 친절하게 알려주고 종료 ─────────────────────────
const env = (k, d = '') => (process.env[k] ?? d).trim()
const cfg = {
  botToken: env('SLACK_BOT_TOKEN'),
  appToken: env('SLACK_APP_TOKEN'),
  ownerId: env('SLACK_OWNER_ID'),
  memoryDir: path.resolve(env('MEMORY_DIR', '../memory-template')),
  claudeBin: env('CLAUDE_BIN', 'claude'),
  model: env('CLAUDE_MODEL'),
  timeoutMs: Number(env('CLAUDE_TIMEOUT_SEC', '300')) * 1000,
  idleMs: Number(env('SESSION_IDLE_HOURS', '8')) * 3600_000,
}
const missing = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_OWNER_ID'].filter((k) => !env(k))
if (missing.length) {
  console.error(`[bridge] .env 에 ${missing.join(', ')} 가 없습니다. bridge/.env.example 을 .env 로 복사해 채우세요.`)
  console.error('[bridge] 토큰 발급: https://api.slack.com/apps → 앱 생성 → Socket Mode 켜기 → OAuth 설치 (bridge/README.md)')
  process.exit(1)
}
if (!existsSync(path.join(cfg.memoryDir, 'CLAUDE.md'))) {
  console.error(`[bridge] MEMORY_DIR(${cfg.memoryDir}) 에 CLAUDE.md 가 없습니다. 기억 레포 경로를 확인하세요.`)
  process.exit(1)
}

// ── 1. 세션 상태: DM 채널 하나에 claude 세션 하나. 오래 쉬면 새 세션 ─────────────
const SESSIONS_FILE = path.join(process.cwd(), '.sessions.json')
const sessions = existsSync(SESSIONS_FILE) ? JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')) : {}
const saveSessions = () => writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2))

function sessionFor(channel, reset = false) {
  const s = sessions[channel]
  const fresh = reset || !s || Date.now() - s.lastAt > cfg.idleMs
  if (fresh) sessions[channel] = { id: randomUUID(), createdAt: Date.now(), lastAt: Date.now(), turns: 0 }
  return { ...sessions[channel], fresh }
}

// ── 2. claude -p 호출: stdin 으로 프롬프트, JSON 으로 결과 ─────────────────────
function runClaude(prompt, session) {
  const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits']
  args.push(session.fresh ? '--session-id' : '--resume', session.id)
  if (cfg.model) args.push('--model', cfg.model)
  if (session.fresh) {
    const today = new Date().toLocaleDateString('ko-KR', { dateStyle: 'full' })
    args.push('--append-system-prompt', `지금은 슬랙 DM 대화다. 오늘은 ${today}. 답은 슬랙에 맞게 짧게, 마크다운 헤더 없이.`)
  }
  return new Promise((resolve) => {
    const childEnv = { ...process.env }
    delete childEnv.CLAUDECODE // Claude Code 세션 안에서 테스트할 때 중첩 실행 거부를 피한다
    const child = spawn(cfg.claudeBin, args, { cwd: cfg.memoryDir, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000) }, cfg.timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, text: `claude 실행 실패: ${e.message} (CLAUDE_BIN 확인)` }) })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (signal) return resolve({ ok: false, text: `${cfg.timeoutMs / 1000}초 안에 답을 못 만들었어요. 더 쪼개서 물어봐 주세요.` })
      try {
        const j = JSON.parse(out)
        if (j.is_error) return resolve({ ok: false, text: `오류: ${String(j.result).slice(0, 500)}` })
        return resolve({ ok: true, text: j.result ?? '(빈 응답)', cost: j.total_cost_usd, turns: j.num_turns })
      } catch {
        return resolve({ ok: false, text: `claude 가 비정상 종료(code ${code}): ${(err || out).slice(0, 500)}` })
      }
    })
    child.stdin.end(prompt)
  })
}

// ── 3. 원문 로그: 야간 증류가 읽는 재료. 기억 레포 chat/YYYY-MM-DD.jsonl ────────
function logTurn(channel, role, text) {
  const dir = path.join(cfg.memoryDir, 'chat')
  mkdirSync(dir, { recursive: true })
  const day = new Date().toISOString().slice(0, 10)
  appendFileSync(path.join(dir, `${day}.jsonl`), JSON.stringify({ at: new Date().toISOString(), channel, role, text }) + '\n')
}

// ── 4. 동시성 1: 같은 기억 레포에 두 세션이 동시에 쓰지 않도록 직렬화 ────────────
let chain = Promise.resolve()
const enqueue = (job) => (chain = chain.then(job, job))

const chunk = (s, n = 3900) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) ?? ['']

// ── 5. Slack ───────────────────────────────────────────────────────────────
const app = new App({ token: cfg.botToken, appToken: cfg.appToken, socketMode: true })

app.message(async ({ message, say }) => {
  if (message.subtype || message.bot_id) return // 수정·삭제·봇 메시지 무시
  if (message.channel_type !== 'im') return // DM 만
  if (message.user !== cfg.ownerId) return // 주인만 (개인 비서다)
  const text = (message.text ?? '').trim()
  if (!text) return

  if (/^\/(new|reset)$/i.test(text)) {
    sessionFor(message.channel, true)
    saveSessions()
    return say('새 대화를 시작할게요.')
  }

  await enqueue(async () => {
    const session = sessionFor(message.channel)
    logTurn(message.channel, 'user', text)
    const t0 = Date.now()
    const r = await runClaude(text, session)
    if (r.ok) {
      sessions[message.channel].lastAt = Date.now()
      sessions[message.channel].turns++
      saveSessions()
    } else if (session.fresh) {
      delete sessions[message.channel] // 첫 턴부터 실패한 세션은 버린다
    }
    logTurn(message.channel, 'assistant', r.text)
    console.log(`[bridge] ${r.ok ? 'ok' : 'fail'} ${((Date.now() - t0) / 1000).toFixed(1)}s turns=${r.turns ?? '-'} cost=$${r.cost?.toFixed(3) ?? '-'}`)
    for (const part of chunk(r.text)) await say(part)
  })
})

app.error((e) => console.error('[bridge] slack error', e?.message ?? e))

await app.start()
console.log(`[bridge] 연결됨. 기억 레포: ${cfg.memoryDir} · 주인: ${cfg.ownerId} · 타임아웃 ${cfg.timeoutMs / 1000}s`)
