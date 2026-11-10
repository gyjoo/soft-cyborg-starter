# 텔레그램으로 바꾸기 — 슬랙 브리지와 다른 점만

슬랙 Socket Mode 대신 텔레그램 봇 long polling 을 쓴다. `bridge/index.js` 의 0·5번 절만 바뀌고
세션·타임아웃·동시성·로그(1~4번 절)는 그대로다.

## 다른 점

| | 슬랙 | 텔레그램 |
|---|---|---|
| 토큰 | 앱 토큰 + 봇 토큰 2개 | @BotFather 가 주는 봇 토큰 1개 |
| 수신 | Socket Mode (WebSocket) | `getUpdates` long polling (라이브러리가 함) |
| 주인 확인 | `message.user === SLACK_OWNER_ID` | `msg.chat.id === Number(TELEGRAM_OWNER_CHAT_ID)` |
| 글자 제한 | 약 4,000자 | 4,096자 (`chunk(text, 4000)` 그대로 써도 됨) |
| 마크다운 | mrkdwn (헤더 없음) | `parse_mode` 생략하고 평문으로 보내는 게 가장 안전 |
| 서식 깨짐 | 거의 없음 | `*`·`_` 가 있으면 MarkdownV2 파싱 오류 → 평문 권장 |

## 준비

1. 텔레그램에서 @BotFather → `/newbot` → 토큰 복사. `.env` 에 `TELEGRAM_BOT_TOKEN=`.
2. 봇에게 아무 메시지나 보낸 뒤 `https://api.telegram.org/bot<토큰>/getUpdates` 를 열어 `chat.id` 확인 → `TELEGRAM_OWNER_CHAT_ID=`.
3. `npm i grammy` (`@slack/bolt` 는 지워도 된다).

## 코드 (5번 절 교체)

```js
import { Bot } from 'grammy'
const bot = new Bot(env('TELEGRAM_BOT_TOKEN'))
const OWNER = Number(env('TELEGRAM_OWNER_CHAT_ID'))

bot.on('message:text', async (ctx) => {
  if (ctx.chat.id !== OWNER) return
  const text = ctx.message.text.trim()
  const channel = String(ctx.chat.id)
  if (/^\/(new|reset)$/i.test(text)) { sessionFor(channel, true); saveSessions(); return ctx.reply('새 대화를 시작할게요.') }
  await enqueue(async () => {
    const session = sessionFor(channel)
    logTurn(channel, 'user', text)
    const r = await runClaude(text, session)
    if (r.ok) { sessions[channel].lastAt = Date.now(); sessions[channel].turns++; saveSessions() }
    else if (session.fresh) delete sessions[channel]
    logTurn(channel, 'assistant', r.text)
    for (const part of chunk(r.text, 4000)) await ctx.reply(part)
  })
})
bot.start()
console.log('[bridge] 텔레그램 polling 시작')
```

0번 절의 `missing` 검사도 `['TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_CHAT_ID']` 로 바꾼다.

## 언제 텔레그램이 나은가

회사 슬랙과 개인 비서를 섞고 싶지 않을 때, 폰 알림을 따로 받고 싶을 때, 가족에게도 봇을 열어주고 싶을 때(채팅 id 를 여러 개 허용하면 된다).
반대로 회사 채널의 글을 비서가 읽어야 한다면 슬랙이어야 한다.
