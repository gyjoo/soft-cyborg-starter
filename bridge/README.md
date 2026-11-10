# bridge/ — 슬랙 DM ↔ claude -p 최소 브리지

한 파일(`index.js`, 약 130줄)로 "메시지 수신 → 기억 레포에서 `claude -p` → 답장" 을 한다.

## 준비

1. https://api.slack.com/apps 에서 앱 생성 → **Socket Mode** 켜기 → App-Level Token 발급 (`connections:write`).
2. **Event Subscriptions** 켜고 bot events 에 `message.im` 추가.
3. **OAuth & Permissions** 에서 bot scopes `chat:write`, `im:history`, `im:read` 추가 → 워크스페이스에 설치 → Bot User OAuth Token 복사.
4. **App Home** 탭에서 "Allow users to send Slash commands and messages from the messages tab" 체크 (DM 을 받으려면 필요).
5. `cp .env.example .env` 후 토큰 둘, 내 사용자 ID, `MEMORY_DIR` 채우기.

## 실행

```sh
npm install
npm start
```

토큰이 비어 있으면 무엇이 빠졌는지 출력하고 바로 종료한다. 연결되면 `[bridge] 연결됨` 이 찍히고, 슬랙에서 봇에게 DM 을 보내면 답이 온다.
`/new` 를 보내면 세션을 리셋한다.

## 동작 요약

- **세션**: DM 채널마다 claude 세션 하나. 첫 턴은 `--session-id`, 이후는 `--resume`. `SESSION_IDLE_HOURS` 넘게 쉬면 새 세션.
- **동시성 1**: 메시지가 겹쳐도 한 번에 하나만 claude 를 돌린다 (기억 파일 동시 수정 방지).
- **타임아웃**: `CLAUDE_TIMEOUT_SEC` 넘으면 프로세스를 죽이고 사과 메시지. 긴 일은 `workers/` 패턴으로.
- **권한**: `--permission-mode acceptEdits` 라 기억 레포 안 파일 쓰기는 허용, 쉘 실행은 막힌다.
- **로그**: 원문 대화는 `MEMORY_DIR/chat/YYYY-MM-DD.jsonl` 에 append → 야간 증류의 재료.

## 상시 실행 (macOS)

`launchd` 로 로그인 시 자동 시작하고 죽으면 재시작한다. `~/Library/LaunchAgents/com.example.soft-cyborg-bridge.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.example.soft-cyborg-bridge</string>
  <key>ProgramArguments</key><array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd $HOME/soft-cyborg-starter/bridge && npm start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/soft-cyborg-bridge.log</string>
  <key>StandardErrorPath</key><string>/tmp/soft-cyborg-bridge.log</string>
</dict></plist>
```

`launchctl load ~/Library/LaunchAgents/com.example.soft-cyborg-bridge.plist`. 맥이 잠들지 않게 `sudo pmset -a sleep 0 disksleep 0` 도 같이.

`-lc` 로 로그인 셸을 쓰는 이유: launchd 환경에는 PATH 가 거의 없어서 `claude`·`node` 를 못 찾는다. nvm 을 쓴다면 `.zprofile` 에서 로드되게 해 둘 것.

텔레그램으로 바꾸려면 `docs/telegram.md`.
