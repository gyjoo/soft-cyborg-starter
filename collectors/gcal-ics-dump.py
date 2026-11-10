#!/usr/bin/env python3
"""Google Calendar 일정을 JSON 으로 떨어뜨린다 (표준 라이브러리만, OAuth 없음).

구글 캘린더 설정 → 내 캘린더 → "일정 액세스 권한" 아래 **iCal 형식의 비공개 주소** 를 GCAL_ICS_URL 로.
    GCAL_ICS_URL='https://calendar.google.com/calendar/ical/.../basic.ics' MEMORY_DIR=../memory-template python3 collectors/gcal-ics-dump.py
결과: MEMORY_DIR/calendar/upcoming.json — 어제부터 14일치, 시작 시각순. 반복 일정은 첫 회차만 들어온다(RRULE 미전개, recurring: true 표시).
크론 예: */30 * * * * (비공개 주소는 토큰이나 다름없다 — .env 에만 두고 로그에 찍지 말 것)
"""
import json, os, re, sys, urllib.request
from datetime import datetime, timedelta, timezone, date
from zoneinfo import ZoneInfo

URL = os.environ.get("GCAL_ICS_URL", "")
OUT = os.path.join(os.path.abspath(os.environ.get("MEMORY_DIR", "../memory-template")), "calendar", "upcoming.json")
if not URL:
    sys.exit("GCAL_ICS_URL 이 비어 있습니다. 구글 캘린더 설정의 '비공개 iCal 주소'를 넣으세요.")

raw = urllib.request.urlopen(URL, timeout=30).read().decode("utf-8", "replace")
lines = re.sub(r"\r?\n[ \t]", "", raw).splitlines()  # 접힌 줄(75자 개행) 펴기

def parse_dt(prop: str, value: str):
    tz = re.search(r"TZID=([^;:]+)", prop)
    if re.search(r"VALUE=DATE(?!-)", prop) or len(value) == 8:
        return datetime.strptime(value, "%Y%m%d").replace(tzinfo=LOCAL), True
    if value.endswith("Z"):
        return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).astimezone(LOCAL), False
    return datetime.strptime(value, "%Y%m%dT%H%M%S").replace(tzinfo=ZoneInfo(tz.group(1)) if tz else LOCAL).astimezone(LOCAL), False

LOCAL = datetime.now().astimezone().tzinfo
lo, hi = datetime.now(LOCAL) - timedelta(days=1), datetime.now(LOCAL) + timedelta(days=14)
events, cur = [], None
for line in lines:
    if line == "BEGIN:VEVENT": cur = {}
    elif line == "END:VEVENT" and cur is not None:
        if "start" in cur and lo <= cur["start"] <= hi:
            events.append({**cur, "start": cur["start"].isoformat(), "end": cur.get("end") and cur["end"].isoformat()})
        cur = None
    elif cur is not None and ":" in line:
        prop, value = line.split(":", 1)
        name = prop.split(";")[0]
        if name in ("DTSTART", "DTEND"):
            dt, all_day = parse_dt(prop, value)
            cur["start" if name == "DTSTART" else "end"] = dt
            cur["all_day"] = all_day
        elif name == "SUMMARY": cur["title"] = value.replace("\\,", ",").replace("\\n", " ")
        elif name == "LOCATION": cur["location"] = value.replace("\\,", ",")
        elif name == "RRULE": cur["recurring"] = True

events.sort(key=lambda e: e["start"])
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"generated_at": datetime.now(LOCAL).isoformat(), "events": events}, f, ensure_ascii=False, indent=1)
print(f"[gcal] {len(events)}개 일정 → {OUT}")
