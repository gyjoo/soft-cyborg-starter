# 윈도우 PC 에서 돌리기

"항상 켜둔 맥" 이 없어도 된다. 안 쓰는 윈도우 PC 한 대면 같은 구조가 그대로 돈다.
**권장안은 WSL2(우분투)** 다 — 이 레포의 셸 스크립트·크론·`claude`/`codex` CLI 가 수정 없이 돌고, 맥 사용자와 같은 문서를 보면 된다.
WSL 을 쓸 수 없을 때(회사 정책 등)의 네이티브 윈도우 변경표는 4절에.

## 1. WSL2 우분투 + 도구 설치

관리자 PowerShell 에서 한 줄:

```powershell
wsl --install -d Ubuntu
```

재부팅 후 우분투 터미널이 열리면 사용자 이름·비밀번호를 만든다(예: `haneul`). 그 안에서:

```sh
sudo apt update && sudo apt install -y git curl build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs   # Node 22 (20 이상이면 됨)
npm i -g @anthropic-ai/claude-code      # 또는 npm i -g @openai/codex (docs/codex.md)
claude                                  # 한 번 실행해 브라우저로 로그인
git clone <이 레포 URL> ~/soft-cyborg-starter
cp -r ~/soft-cyborg-starter/memory-template ~/memory && cd ~/memory && git init && git add -A && git commit -m init
```

**기억 레포는 반드시 `/home/<이름>/...` 아래에 둔다. `/mnt/c/...` 는 쓰지 않는다.** 이유 두 가지:

- 속도: `/mnt/c` 는 윈도우 파일시스템을 네트워크 드라이브처럼 넘겨 읽는다. `git status`·Grep 이 수십 배 느려지고, 비서가 매 턴 기억 파일 수십 개를 여는 구조라 체감이 크다.
- 권한: 윈도우 쪽 파일은 WSL 에서 전부 `777` 로 보여 git 이 "모든 파일 변경됨" 으로 오인하고, `chmod +x` 가 안 먹어 `delegate.sh` 같은 스크립트 실행이 막힌다.

윈도우 탐색기에서 보고 싶으면 주소창에 `\\wsl$\Ubuntu\home\haneul\memory` 를 치면 된다(읽기용으로만).

브리지·수집기·증류는 맥과 동일하다: `bridge/README.md` 의 Slack 설정 → `npm install && npm start`. 상시 실행만 launchd 대신 아래 2절 방식.

## 2. 부팅 시 자동 시작 — 크론과 브리지

WSL 은 기본적으로 터미널을 닫으면 멈추고, 부팅 시 자동으로 뜨지 않는다. 두 가지를 해결해야 한다.

### 2-a. WSL 안에서 systemd 켜기 (크론·상시 서비스용)

`/etc/wsl.conf` 에:

```ini
[boot]
systemd=true
```

PowerShell 에서 `wsl --shutdown` 뒤 다시 열면 `systemctl` 이 동작한다. 크론은 `sudo systemctl enable --now cron` 한 번으로 켜지고, `crontab -e` 는 맥과 같다:

```
*/30 * * * * cd ~/soft-cyborg-starter && MEMORY_DIR=$HOME/memory GCAL_ICS_URL=... python3 collectors/gcal-ics-dump.py >> ~/memory/gcal.log 2>&1
30 23 * * *  cd ~/soft-cyborg-starter && MEMORY_DIR=$HOME/memory scripts/nightly-distill.sh >> ~/memory/distill.log 2>&1
```

브리지는 launchd plist 대신 systemd 유저 서비스로 띄운다. `~/.config/systemd/user/soft-cyborg-bridge.service`:

```ini
[Unit]
Description=soft-cyborg slack bridge
After=network-online.target

[Service]
WorkingDirectory=/home/haneul/soft-cyborg-starter/bridge
ExecStart=/usr/bin/node --env-file-if-exists=.env index.js
Restart=always
RestartSec=10
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/home/haneul/.npm-global/bin

[Install]
WantedBy=default.target
```

`systemctl --user enable --now soft-cyborg-bridge` 그리고 로그아웃 뒤에도 살아 있게 `sudo loginctl enable-linger haneul`.
로그는 `journalctl --user -u soft-cyborg-bridge -f`.

### 2-b. 윈도우 부팅 때 WSL 자체를 깨우기

systemd 를 켜도 WSL 이 "실행 중" 이어야 한다. 윈도우 작업 스케줄러에 부팅 트리거 작업을 하나 만든다. 관리자 PowerShell:

```powershell
$action  = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d Ubuntu -u haneul -e bash -lc 'sleep 5; systemctl --user start soft-cyborg-bridge; tail -f /dev/null'"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "soft-cyborg-wsl" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest
```

`tail -f /dev/null` 이 핵심이다 — 명령이 끝나면 WSL 이 몇 초 뒤 자동 종료되므로, 끝나지 않는 프로세스 하나를 잡아 둔다.
`-AtLogOn` 을 쓰는 이유는 3절의 자동 로그인과 짝을 맞추기 위해서다(`-AtStartup` 은 사용자 세션이 없어 `systemctl --user` 가 실패할 수 있다).

systemd 를 켜기 싫다면 크론 대신 이 작업 스케줄러에 작업을 더 등록하면 된다. 예: 매일 23:30 야간 증류.

```powershell
$a = New-ScheduledTaskAction -Execute "wsl.exe" -Argument "-d Ubuntu -u haneul -e bash -lc 'cd ~/soft-cyborg-starter && MEMORY_DIR=$HOME/memory scripts/nightly-distill.sh >> ~/memory/distill.log 2>&1'"
$t = New-ScheduledTaskTrigger -Daily -At 23:30
Register-ScheduledTask -TaskName "soft-cyborg-distill" -Action $a -Trigger $t
```

## 3. 절전 끄기 · 자동 로그인

맥의 `pmset` 에 해당하는 것:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 10      # 모니터만 꺼짐, PC 는 깨어 있음
powercfg /hibernate off
```

노트북이면 "덮개를 닫을 때" 를 제어판 → 전원 옵션에서 "아무 것도 안 함" 으로. 윈도우 업데이트 자동 재부팅은 설정 → Windows 업데이트 → "사용 시간" 을 넓게 잡아 둔다.

자동 로그인은 `netplwiz` 를 열고 "사용자가 이 컴퓨터를 사용하려면 사용자 이름과 암호를 입력해야 합니다" 체크를 끈다
(Microsoft 계정·Windows Hello 를 쓰면 이 항목이 안 보이는데, 설정 → 계정 → 로그인 옵션에서 "Microsoft 계정에는 Windows Hello 로그인만 허용" 을 끄면 나타난다).
자동 로그인이 없으면 재부팅 뒤 2-b 의 작업이 실행되지 않아 비서가 조용히 죽는다 — 맥의 "화면 잠금 비밀번호 창" 과 같은 함정이다.

## 4. 네이티브 윈도우(WSL 없이) — 바꿔야 할 것

Node 브리지와 두 수집기는 그대로 돈다. 셸 스크립트와 스케줄링만 바뀐다.

| 레포의 것 | 네이티브 윈도우에서 | 비고 |
|---|---|---|
| `bridge/index.js` | **그대로** | Node 20+ 설치, `.env` 에 `CLAUDE_BIN=claude.cmd` (npm 전역 설치 시 `.cmd` 래퍼) |
| `collectors/health-export-server.js` | **그대로** | 윈도우 방화벽에서 8787 포트 인바운드 허용 |
| `collectors/gcal-ics-dump.py` | **그대로** | `python3` → `py` 또는 `python` |
| `scripts/nightly-distill.sh` | PowerShell 로 재작성 | 아래 예시. 프롬프트 파일 `scripts/prompts/nightly-distill.md` 는 그대로 쓴다 |
| `workers/delegate.sh` | PowerShell + `Start-Process` | `nohup ... &` → `Start-Process -NoNewWindow -RedirectStandardOutput` |
| `scripts/install-gitleaks-hook.sh` | 훅 내용은 같음 | `winget install gitleaks`, 훅 파일은 `sh` 없이도 git 이 자체 sh 로 실행 |
| crontab | 작업 스케줄러 | `Register-ScheduledTask` (2절과 같은 꼴, `-Execute "pwsh"`) |
| launchd plist | 작업 스케줄러 `-AtLogOn` + `-RestartCount` | 또는 `nssm` 으로 윈도우 서비스화 |
| 맥 전용 수집 아이디어(launchd 기반 상시 서버, Apple 앱 DB 직접 읽기) | **제외** | HTTP 로 받는 Health Auto Export·URL 로 받는 Google Calendar 만 사용 — 둘 다 폰·구글이 보내므로 OS 무관 |

야간 증류 PowerShell 예시(`scripts/nightly-distill.ps1`):

```powershell
param([string]$Day = (Get-Date -Format 'yyyy-MM-dd'))
$Mem = $env:MEMORY_DIR ?? "$PSScriptRoot\..\memory-template"
Set-Location $Mem
if (Test-Path "journal\$Day.md") { "이미 있음"; exit 0 }
if (-not (Test-Path "chat\$Day.jsonl")) { "대화 없음"; exit 0 }
$prompt = (Get-Content "$PSScriptRoot\prompts\nightly-distill.md" -Raw) -replace '\{\{DAY\}\}', $Day
Remove-Item Env:CLAUDECODE -ErrorAction SilentlyContinue
$out = $prompt | claude -p --output-format json --permission-mode acceptEdits --allowedTools 'Read,Edit,Write,Grep,Glob' --max-turns 40 | ConvertFrom-Json
"[distill] $($out.num_turns) turns, `$$([math]::Round($out.total_cost_usd,3)): $($out.result.Substring(0, [math]::Min(300, $out.result.Length)))"
if (Test-Path "journal\$Day.md") { git add -A; git commit -qm "journal: $Day 증류"; git push -q }
```

워커 위임의 핵심 한 줄:

```powershell
Start-Process -FilePath "pwsh" -ArgumentList "-File", "$PSScriptRoot\delegate-run.ps1", $Wt, $Branch, $Task `
  -NoNewWindow -RedirectStandardOutput "$Wt.log" -RedirectStandardError "$Wt.err.log"
```

주의할 차이: PowerShell 5.1(윈도우 내장)은 `??` 연산자가 없다. `winget install Microsoft.PowerShell` 로 7.x(`pwsh`)를 쓴다.
파일 인코딩은 `-Encoding utf8` 을 명시하지 않으면 한글 기억 파일이 깨질 수 있다. git 은 `core.autocrlf=false` 로 두어 증류본의 줄바꿈이 섞이지 않게 한다.

## 5. 확인

WSL:

```sh
wsl -d Ubuntu -u haneul -e bash -lc 'cd ~/memory && claude -p "내 이름이 뭐고 지금 뭘 하고 있어? 두 문장" && systemctl --user is-active soft-cyborg-bridge'
```

ME.md 내용으로 답하고 마지막 줄이 `active` 면 끝이다. 네이티브면 PowerShell 에서 `cd ~\memory; claude -p "..."` 만 확인하면 된다.
재부팅 한 번 해 보고 슬랙 DM 에 "살아있니?" 를 보내 답이 오는지까지가 진짜 확인이다.
