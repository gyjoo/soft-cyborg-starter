# 두뇌를 OpenAI Codex CLI 로 바꾸기

이 스타터의 "두뇌" 는 `claude -p` 한 줄이다. 그 자리에 `codex exec` 를 넣으면 같은 기억 레포·같은 브리지·같은 워커가
OpenAI 모델로 돈다. 기억이 파일이기 때문에 가능한 일이고, 바뀌는 코드는 합쳐서 20줄이 안 된다.

전제: `npm i -g @openai/codex` 로 설치하고 `codex` 를 한 번 실행해 ChatGPT 계정으로 로그인해 둔다(Plus/Pro 구독에 포함, API 키 불필요).

## 1. 브리지 — `runClaude` 를 `codex exec` 로

`codex exec "<프롬프트>"` 는 비대화 모드다. 지정한 디렉토리에서 돌고, 마지막 답만 받는다.
`claude -p` 와 다른 점은 세 가지: 프롬프트를 stdin 이 아니라 인자로 주고, 결과가 JSON 이 아니라 평문이며,
작업 디렉토리를 `--cd` 로도 줄 수 있다. 세션 이어가기(`--resume`) 는 없다고 보고 매 턴 새로 시작한다 — 기억은 어차피 파일에 있다.

```diff
--- a/bridge/index.js
+++ b/bridge/index.js
@@ 2. claude -p 호출
-function runClaude(prompt, session) {
-  const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits']
-  args.push(session.fresh ? '--session-id' : '--resume', session.id)
-  if (cfg.model) args.push('--model', cfg.model)
-  if (session.fresh) {
-    const today = new Date().toLocaleDateString('ko-KR', { dateStyle: 'full' })
-    args.push('--append-system-prompt', `지금은 슬랙 DM 대화다. 오늘은 ${today}. 답은 슬랙에 맞게 짧게, 마크다운 헤더 없이.`)
-  }
+function runClaude(prompt, session) {           // 이름은 그대로 두면 5번 절을 안 고쳐도 된다
+  const today = new Date().toLocaleDateString('ko-KR', { dateStyle: 'full' })
+  const full = `지금은 슬랙 DM 대화다. 오늘은 ${today}. 답은 슬랙에 맞게 짧게, 마크다운 헤더 없이.\n\n${prompt}`
+  const outFile = path.join(os.tmpdir(), `codex-${Date.now()}.md`)
+  const args = ['exec', '--cd', cfg.memoryDir, '--sandbox', 'workspace-write', '--output-last-message', outFile]
+  if (cfg.model) args.push('--model', cfg.model)
+  args.push(full)
   return new Promise((resolve) => {
     const childEnv = { ...process.env }
     delete childEnv.CLAUDECODE
-    const child = spawn(cfg.claudeBin, args, { cwd: cfg.memoryDir, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] })
+    const child = spawn(cfg.claudeBin, args, { cwd: cfg.memoryDir, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
     ...
     child.on('close', (code, signal) => {
       clearTimeout(timer)
       if (signal) return resolve({ ok: false, text: `${cfg.timeoutMs / 1000}초 안에 답을 못 만들었어요. 더 쪼개서 물어봐 주세요.` })
-      try {
-        const j = JSON.parse(out)
-        if (j.is_error) return resolve({ ok: false, text: `오류: ${String(j.result).slice(0, 500)}` })
-        return resolve({ ok: true, text: j.result ?? '(빈 응답)', cost: j.total_cost_usd, turns: j.num_turns })
-      } catch {
-        return resolve({ ok: false, text: `claude 가 비정상 종료(code ${code}): ${(err || out).slice(0, 500)}` })
-      }
+      let text = ''
+      try { text = fs.readFileSync(outFile, 'utf8').trim(); fs.unlinkSync(outFile) } catch {}
+      if (code !== 0) return resolve({ ok: false, text: `codex 가 비정상 종료(code ${code}): ${(err || out).slice(0, 500)}` })
+      return resolve({ ok: true, text: text || out.trim() || '(빈 응답)' })
     })
-    child.stdin.end(prompt)
   })
 }
```

`.env` 는 두 줄만 바뀐다: `CLAUDE_BIN=codex`, `CLAUDE_MODEL=` 은 비우거나 `gpt-5-codex` 같은 Codex 모델명.
`import os from 'node:os'` 를 상단에 추가한다. 세션 파일(`.sessions.json`)과 `/new` 는 그대로 두어도 무해하다 — 쓰이지 않을 뿐이다.

`--output-last-message` 를 쓰는 이유: Codex 는 stdout 에 진행 로그와 답을 섞어 내보내는 버전이 있어, 마지막 답만 파일로 받는 쪽이 안전하다.
`--json` 을 주면 JSONL 이벤트 스트림을 받을 수 있지만 브리지 용도로는 과하다.

## 2. 기억 레포 — AGENTS.md 한 줄

Codex 는 `CLAUDE.md` 를 읽지 않고 작업 디렉토리의 `AGENTS.md` 를 읽는다. 규칙을 두 벌 유지하지 말고 한 줄로 넘긴다.
`memory-template/AGENTS.md` 가 이미 그렇게 되어 있다:

```
이 디렉토리의 CLAUDE.md 를 먼저 읽고, 거기 적힌 규칙을 그대로 적용하라. (Codex·기타 에이전트용 진입점)
```

이 파일은 Claude Code 에는 아무 영향이 없으므로 두 엔진을 번갈아 써도 된다. `~/.codex/AGENTS.md` 에 전역 규칙을 두는 방법도 있지만,
기억 레포 안에 두어야 레포를 옮겼을 때 같이 간다.

## 3. 워커 — 같은 치환

`workers/delegate.sh` 의 `--run` 블록에서 `claude -p ... | python3 ...` 두 단계를 `codex exec` 한 단계로 바꾼다.

```diff
--- a/workers/delegate.sh
+++ b/workers/delegate.sh
-  OUT=$(printf '%s' "$PROMPT" | claude -p --output-format json --permission-mode acceptEdits \
-        --allowedTools 'Read,Edit,Write,Grep,Glob,Bash(git *),Bash(npm *),Bash(python3 *)' 2>>"$WT.log") || true
-  SUMMARY=$(printf '%s' "$OUT" | python3 -c 'import json,sys
-try:
-    j = json.load(sys.stdin); print(("실패: " if j.get("is_error") else "") + str(j.get("result",""))[:1500])
-except Exception: print("(결과 JSON 파싱 실패 — 로그를 확인하세요)")')
+  codex exec --cd "$WT" --full-auto --output-last-message "$WT.last.md" "$PROMPT" >> "$WT.log" 2>&1 || true
+  SUMMARY=$(head -c 1500 "$WT.last.md" 2>/dev/null || echo "(결과 없음 — 로그를 확인하세요)")
```

`--full-auto` 는 "워크스페이스 안 쓰기 허용 + 명령 자동 승인" 이다. Claude 쪽 `--allowedTools` 처럼 도구 단위로 좁히는 옵션은 없으므로,
워커가 건드릴 수 있는 범위는 워크트리 디렉토리로 격리하는 것(이미 그렇게 되어 있다)과 `~/.codex/config.toml` 의 `sandbox_mode` 로 제한한다.
프롬프트 첫 줄 "질문할 사람이 없다" 는 그대로 둔다 — Codex 도 묻는 순간 멈춘다.

## 4. MCP 서버 등록 — `~/.codex/config.toml`

Claude Code 의 `claude mcp add` 에 해당하는 것은 설정 파일이다. 예시(전부 가상):

```toml
# ~/.codex/config.toml
model = "gpt-5-codex"
approval_policy = "on-request"      # 비대화 exec 에서는 --full-auto / --sandbox 가 우선한다
sandbox_mode = "workspace-write"

[mcp_servers.calendar]
command = "npx"
args = ["-y", "@example/mcp-calendar"]
env = { CALENDAR_ICS_URL = "https://calendar.example.com/private/abc/basic.ics" }

[mcp_servers.home]
command = "node"
args = ["/Users/haneul/tools/home-mcp/index.js"]

[mcp_servers.remote-notes]
url = "https://notes.example.com/mcp"
bearer_token_env_var = "NOTES_MCP_TOKEN"   # 값은 .secrets.env 에서 export, 파일엔 이름만
```

토큰 값은 이 파일에도 쓰지 않는다. `bearer_token_env_var` 처럼 **환경변수 이름**만 적고, 값은 `.secrets.env` 에서 셸이 export 하게 한다.
이 스타터의 수집기(건강·캘린더)는 MCP 없이 파일로 떨어뜨리는 방식이라 두 엔진 어느 쪽에서도 그대로 읽힌다.

## 5. 어느 엔진을 언제

둘 다 구독으로 돌릴 수 있으니 "하나만 고르기" 보다 "일 종류로 나누기" 가 실용적이다. 운영하며 굳어진 기준:

| 일 | 권장 | 이유 |
|---|---|---|
| 슬랙 대화·판단·요약·글쓰기 | Claude | 긴 맥락·톤 유지·"묻지 말고 기록" 같은 규칙 준수가 안정적 |
| UI·프런트엔드·디자인 조정 | Claude | 스크린샷 읽기·시각 피드백 반영이 자연스럽다 |
| 백엔드·데이터 파이프라인·SQL·dbt | Codex | 긴 코드 변경을 묵묵히 끝까지 밀고, 테스트 루프가 빠르다 |
| 반복적 리팩터·마이그레이션 워커 | Codex | 승인 없이 오래 도는 `--full-auto` 가 편하다 |
| 야간 증류 | Claude | 기억 파일 갱신 규칙(모순 표기·REDACTED)을 더 잘 지킨다 |

구현은 간단하다. 브리지는 `CLAUDE_BIN=claude` 로 두고, 워커 스크립트에 `ENGINE=${ENGINE:-claude}` 한 줄을 넣어
`ENGINE=codex workers/delegate.sh "..."` 처럼 호출할 때만 Codex 를 쓰면 된다. 두 엔진 모두 같은 기억 레포를 읽으므로
어느 쪽이 쓴 결과든 다음 턴의 상대가 그대로 이어받는다.

한도 측면에서도 둘을 나누면 좋다. Claude Max 주간 창이 바닥날 때 백엔드 워커를 Codex 로 돌리면 대화용 한도가 남는다.

## 확인

```sh
cd ~/memory && codex exec --cd . "내 이름이 뭐고 지금 뭘 하고 있어? 두 문장. 파일 수정 금지"
```

ME.md 내용으로 답하면 AGENTS.md → CLAUDE.md 연결이 된 것이다. 안 되면 `codex` 를 대화 모드로 한 번 열어 로그인 상태부터 본다.
