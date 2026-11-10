# soft-cyborg-starter

> 항상 켜둔 맥 한 대 + Claude Code CLI + 마크다운 기억 레포로 "나만 아는 개인 AI 비서" 를 만드는 출발점.

## Executive Summary

- 개인 비서의 핵심은 모델이 아니라 **기억**이다. 이 레포는 기억을 마크다운 파일(git)로 두고, `claude -p` 를 그 디렉토리에서 돌려 비서가 매 턴 자기 기억을 읽고 쓰게 한다.
- 구조는 네 층뿐이다: **기억 레포 / 브리지(슬랙 DM↔claude) / 워커(긴 일 위임) / 수집기(건강·캘린더)**. 전부 합쳐 코드 400줄 남짓.
- 비용은 Claude Max 구독 하나(월 $100~200)로 충분하고, 서버·DB·벡터 검색은 필요 없다. 맥 한 대를 안 끄면 된다.
- 1년 넘게 실제로 굴린 개인 비서 시스템에서 **구조와 교훈만** 추려 새로 썼다. 예시 데이터는 전부 가상 인물(김하늘)이다.
- 다섯 단계로 시작한다: 맥 상시 가동 → 기억 레포 → 입력 채널 하나 → 데이터 소스 하나씩 → 야간 증류 크론.

---

## 왜 이렇게 만드나

ChatGPT·Claude 앱의 "메모리" 는 내 것이 아니다. 어디에 뭐가 저장됐는지 못 보고, 고칠 수 없고, 다른 모델로 옮길 수도 없다.
반대로 기억이 **내 git 레포 안의 마크다운**이면

- 비서가 뭘 아는지 `cat` 으로 본다, 틀리면 `vim` 으로 고친다, 이력은 `git log` 에 있다.
- 모델·CLI 가 바뀌어도 기억은 그대로다. 내일 다른 회사 CLI 로 바꿔도 `cwd` 만 같으면 된다.
- 건강 데이터·일정·대화 로그가 같은 디렉토리에 떨어지니 비서가 그냥 파일을 열어 보면 된다.

`claude -p` 는 실행 디렉토리의 `CLAUDE.md` 를 자동으로 읽는다. 그래서 **기억 레포의 `CLAUDE.md` 가 비서의 인격이자 규칙이고**, 코드는 거의 안 바뀐다.

## 네 층

| 층 | 디렉토리 | 하는 일 | 크기 |
|---|---|---|---|
| 기억 레포 | `memory-template/` | 비서가 읽고 쓰는 마크다운. `CLAUDE.md` 가 규칙, 나머지가 사실 | 파일 10개 |
| 브리지 | `bridge/` | 슬랙 DM 을 받아 `claude -p` 에 넣고 답을 돌려줌. 세션 유지·타임아웃·동시성 1 | 130줄 |
| 워커 | `workers/` | 1분 넘는 일을 git worktree + 백그라운드 claude 에 위임, 끝나면 DM | 50줄 |
| 수집기 | `collectors/` | Apple Health·Google Calendar 를 날짜별 JSON 으로 저장. LLM 호출 없음 | 각 50줄 |

그리고 `scripts/nightly-distill.sh` 가 매일 밤 그날 대화를 `journal/YYYY-MM-DD.md` 한 장으로 증류하고 기억 파일을 갱신한다.
그림과 운영 교훈은 [docs/architecture.md](docs/architecture.md).

## 시작하기 — 다섯 단계

### 1. 항상 켜둘 맥 + Claude Code CLI

- 안 쓰는 맥북·맥미니 아무거나. 뚜껑 닫아도 안 자게: `sudo pmset -a sleep 0 disablesleep 1`
- Claude Code CLI 설치 후 `claude` 를 한 번 실행해 Max 구독 계정으로 로그인 (아래 "비용·계정" 참고).
- Node 20.12 이상 (`node --env-file` 을 쓴다). `brew install node` 또는 nvm.
- 확인: `claude -p "안녕" --output-format json` 이 JSON 을 뱉으면 됨.

### 2. 기억 레포 만들기

```sh
git clone <이 레포 URL> ~/soft-cyborg-starter
cd ~/soft-cyborg-starter
cp -r memory-template ~/memory && cd ~/memory && git init && git add -A && git commit -m "init"
```

- `ME.md`·`preferences.md`·`people/` 의 가상 인물(김하늘)을 **본인 얘기로 전부 바꾼다.** 처음엔 10줄이면 충분하다. 비서가 채워 나간다.
- `CLAUDE.md` 는 그대로 써도 되지만 "답변 톤" 절은 취향대로.
- 비공개 GitHub 레포를 하나 만들어 원격으로 연결한다 (백업 + 다른 기기에서 읽기).
- 시크릿 훅: `brew install gitleaks && ~/soft-cyborg-starter/scripts/install-gitleaks-hook.sh ~/memory`
- 확인: `cd ~/memory && claude -p "내 이름이 뭐고 지금 뭘 하고 있어?"` 에 ME.md 내용으로 답하면 됨.

### 3. 입력 채널 하나 — 슬랙 DM

```sh
cd ~/soft-cyborg-starter/bridge
cp .env.example .env     # 토큰 채우기 — 절차는 bridge/README.md
npm install && npm start
```

- 토큰 없이 `npm start` 하면 뭐가 빠졌는지 알려주고 종료한다. 채우면 "연결됨" 이 뜨고, 슬랙에서 봇 DM 에 말을 걸면 답한다.
- 세션은 채널별로 유지되고 8시간 쉬면 새로 시작한다. `/new` 로 강제 리셋.
- 텔레그램이 편하면 [docs/telegram.md](docs/telegram.md) — 바뀌는 건 30줄.
- 상시 실행은 `bridge/README.md` 의 launchd plist.

### 4. 데이터 소스 하나씩

순서는 **가장 자주 물어볼 것부터.** 보통 일정 → 건강 → 그다음.

- **Google Calendar**: 비공개 iCal 주소를 `GCAL_ICS_URL` 로 주고 `collectors/gcal-ics-dump.py` 를 30분 크론. → `calendar/upcoming.json`
- **Apple Health**: 폰에 Health Auto Export 앱 → REST 자동화로 `collectors/health-export-server.js` 에 POST. → `health/YYYY-MM-DD.json`
- 비서는 이 파일들을 그냥 읽는다. `CLAUDE.md` 파일 지도에 적혀 있으므로 따로 알려줄 필요 없다.
- 다음 후보: 메일 요약, 가계부 CSV, 깃허브 알림, 독서 기록 — 전부 "파일로 떨어뜨리기만" 하면 된다. 절차는 `collectors/README.md`.

### 5. 야간 증류 크론

```
30 23 * * * cd ~/soft-cyborg-starter && MEMORY_DIR=$HOME/memory scripts/nightly-distill.sh >> ~/memory/distill.log 2>&1
```

- 그날 `chat/YYYY-MM-DD.jsonl` (브리지가 쌓는 원문) + 건강·일정 데이터 → `journal/YYYY-MM-DD.md` 한 장.
- 지속 가치가 있는 사실은 `preferences`·`projects`·`open-loops`·`people` 에 반영되고 커밋·푸시된다.
- 일주일쯤 돌린 뒤 `journal/` 을 읽어 보면 비서가 뭘 중요하게 여기는지 보인다. 거슬리면 `scripts/prompts/nightly-distill.md` 를 고친다.

## 디렉토리

```
memory-template/      기억 레포 틀. 복사해서 본인 것으로 — 가상 인물 데이터
  CLAUDE.md           비서 규칙: 파일 지도·기록 원칙·시크릿 규율·톤
  ME.md               나는 누구 (200줄 이하)
  preferences.md      선호·습관·소통 방식
  projects.md         진행 중인 일
  open-loops.md       약속·기다리는 것 (체크박스)
  lessons.md          반복하지 말 것
  people/             인물 1명 1파일
  journal/            야간 증류본 (비서가 씀)
  chat/ health/ calendar/   원문·수집 데이터 — git 제외
bridge/               슬랙 Socket Mode ↔ claude -p   (index.js · .env.example · README · launchd)
workers/              delegate.sh — worktree + nohup claude -p + 완료 DM
collectors/           health-export-server.js · gcal-ics-dump.py
scripts/              nightly-distill.sh · prompts/ · install-gitleaks-hook.sh
docs/                 architecture.md (그림·교훈) · telegram.md
```

## 비용·계정

- **Claude**: [Claude Max](https://claude.com/pricing) 구독 ($100 또는 $200/월) 에 Claude Code 사용이 포함된다. API 키 과금 없이 `claude` 로그인만으로 `claude -p` 가 돈다.
  한도는 5시간 창 + 주간 창. 개인 비서 용도(하루 수십 턴 + 야간 증류)는 $100 플랜으로 보통 충분하고, 워커를 자주 돌리면 $200.
  팁: 가벼운 턴은 `CLAUDE_MODEL=claude-sonnet-5-5` 로 돌리고, 증류·워커만 Opus 급을 쓰면 한도가 2~3배 늘어난 효과.
- **Slack**: 무료 워크스페이스면 된다. 봇 토큰·앱 토큰 발급은 https://api.slack.com/apps (절차: `bridge/README.md`). 개인용 워크스페이스를 따로 파는 걸 권한다.
- **Telegram**: @BotFather 에서 무료. 토큰 하나.
- **Health Auto Export**: iOS 앱, 자동화 기능은 유료(연 1~2만원대).
- **Google Calendar**: 설정 → 캘린더 → "비공개 주소(iCal)" 무료.
- **GitHub**: 기억 레포용 비공개 레포 무료.
- 맥 전기세 말고 서버 비용은 0.

## 안전 수칙 (처음부터)

1. 기억 레포는 **비공개**. 공개 레포에 올릴 생각이면 이 스타터처럼 가상 데이터만.
2. 시크릿 값은 `.secrets.env` 에만. 비서에게 토큰을 붙여넣어 줘야 하면 "파일에 적지 말고 쓰기만 해" 라고 같이 말한다. 증류 프롬프트가 `[REDACTED:종류]` 로 바꾸지만 pre-commit gitleaks 까지 두 겹.
3. 브리지는 `SLACK_OWNER_ID` 한 사람의 DM 만 받는다. 채널 메시지·다른 사람은 무시.
4. 메일 발송·결제·외부 게시는 비서가 초안만 쓰게 `CLAUDE.md` 에 적어 둔다.
5. `--permission-mode acceptEdits` 는 파일 편집만 자동 허용한다. 워커의 `--allowedTools` 는 필요한 만큼만 넓힌다.

---

## 부록

### A. 검증한 환경

- macOS 15/26, Node 24, Claude Code CLI 2.1.x, `@slack/bolt` 4.x. `claude -p --output-format json` 의 결과 필드(`result`·`is_error`·`session_id`·`total_cost_usd`) 를 쓴다.
- `node --check bridge/index.js`, `sh -n scripts/*.sh workers/*.sh`, `python3 -m py_compile collectors/*.py` 통과.
- 토큰 없이 `npm start` → 빠진 변수 안내 후 종료(exit 1). `memory-template` 에서 `claude -p "내 이름은?"` → ME.md 기반으로 답.

### B. 자주 막히는 것

| 증상 | 원인·해결 |
|---|---|
| 브리지가 `claude` 를 못 찾음 | launchd 는 PATH 가 좁다. `.env` 에 `CLAUDE_BIN=/절대/경로/claude` |
| 응답이 중첩 세션 오류 | 부모가 Claude Code 안이면 `CLAUDECODE` 환경변수를 지워야 한다 (브리지·스크립트는 이미 지움) |
| 규칙(CLAUDE.md)을 고쳤는데 반영 안 됨 | 이어가는 세션은 시스템 프롬프트 변경을 못 본다. `/new` |
| 슬랙에서 답이 안 옴 | App Home → Messages Tab 허용 체크, `message.im` 이벤트 구독, 재설치 |
| 야간 증류가 "chat 없음" | 브리지가 `MEMORY_DIR/chat/` 에 쓴다. 두 쪽 `MEMORY_DIR` 이 같은지 확인 |
| 맥이 잠듦 | `pmset -g` 로 확인. 외부 모니터 없이 뚜껑 닫으면 `disablesleep 1` 필요 |

### C. 다음 단계 아이디어

- 아침 브리핑 크론: 7시에 `claude -p "오늘 일정·열린 고리·어제 수면 한 줄 브리핑"` → 슬랙 DM (`workers/delegate.sh` 의 notify 함수 재사용).
- 음성: 폰 단축어로 받아쓰기 → 슬랙 DM. 그걸로 끝. STT 서버 필요 없다.
- 기억이 수백 파일을 넘으면 `grep` 보조로 로컬 임베딩 검색을 붙인다. 그 전엔 필요 없다.
- 가족 계정: 텔레그램 봇에 채팅 id 를 여러 개 허용하고, 사람별 기억 디렉토리를 나눈다.

### D. 라이선스

MIT. 마음껏 가져다 쓰고, 본인 비서에 맞게 고치세요.
