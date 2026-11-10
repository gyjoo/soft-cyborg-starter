# collectors/ — 데이터 소스를 기억 레포에 "파일로" 떨어뜨리는 작은 스크립트들

원칙 하나: **수집기는 LLM 을 부르지 않는다.** 원본을 날짜별 파일로 저장만 한다. 해석은 비서(claude -p)가 질문을 받았을 때,
요약은 야간 증류가 한다. 그래서 수집기는 20~60줄이면 충분하고, 고장 나도 대화는 멀쩡하다.

| 수집기 | 소스 | 산출물 | 실행 |
|---|---|---|---|
| `health-export-server.js` | iOS 앱 Health Auto Export (REST API 자동 전송) | `health/YYYY-MM-DD.json` | 상시 서버 (launchd) |
| `gcal-ics-dump.py` | 구글 캘린더 비공개 iCal 주소 | `calendar/upcoming.json` | 크론 30분 |

## 건강 (Health Auto Export)

1. 앱스토어에서 Health Auto Export 설치 (유료 앱, 1회 구매 또는 구독).
2. 맥에서 `MEMORY_DIR=../memory-template HEALTH_KEY=<긴 임의 문자열> node collectors/health-export-server.js`.
3. 앱 → Automations → 새 자동화 → REST API. URL 은 `http://<맥의 Tailscale 또는 LAN 주소>:8787/health`,
   Headers 에 `X-Health-Key: <같은 문자열>`, Export Format JSON, Aggregate Data 켜고 Days, 지표는 걸음·수면·심박·운동 정도.
4. "Export Now" 로 한 번 보내 `health/오늘.json` 이 생기는지 확인.

폰과 맥이 같은 네트워크가 아닐 때는 Tailscale 을 쓰면 된다(무료, 두 기기에 설치만 하면 끝).

## 일정 (Google Calendar)

OAuth 클라이언트 만들 필요 없이 캘린더의 **비공개 iCal 주소** 를 쓴다. 이 주소는 읽기 토큰과 같으니 `.env` 에만.

```sh
GCAL_ICS_URL='https://calendar.google.com/calendar/ical/<...>/private-<...>/basic.ics' \
MEMORY_DIR=../memory-template python3 collectors/gcal-ics-dump.py
```

crontab 예: `*/30 * * * * cd ~/soft-cyborg-starter && set -a && . bridge/.env && set +a && python3 collectors/gcal-ics-dump.py >> /tmp/gcal.log 2>&1`

반복 일정은 첫 회차만 나온다. 반복 전개까지 필요해지면 그때 Google Calendar API(`google-api-python-client`)로 갈아타면 된다.

## 다음에 붙이기 좋은 것

위치(iOS 단축어로 하루 몇 번 좌표 POST), 가계부(카드사 메일 IMAP 파싱), 독서(노션/구글시트 CSV).
어느 것이든 패턴은 같다: 날짜별 파일 하나, LLM 호출 없음, `CLAUDE.md` 파일 지도에 한 줄 추가.
