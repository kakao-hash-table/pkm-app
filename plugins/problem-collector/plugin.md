---
pkm_plugin: 1
id: problem-collector
name: 문제 수집기
version: 0.2.0
author: pkm
permissions:
  ai: [chat]
  bundled: [scripts/collector.mjs, scripts/engine.mjs]
  secrets:
    - { name: REDDIT_CLIENT_ID, label: Reddit 앱 client id, hint: "Reddit 공식 API로만 모아요(robots.txt가 막혀 있어요). script 앱을 만들고 id를 넣어요", url: "https://www.reddit.com/prefs/apps" }
    - { name: REDDIT_CLIENT_SECRET, label: Reddit 앱 secret, url: "https://www.reddit.com/prefs/apps" }
settings:
  - { key: rss, label: RSS 주소, type: lines, placeholder: "https://www.ppomppu.co.kr/rss.php?id=freeboard", hint: "커뮤니티 게시판 RSS를 한 줄에 하나. robots.txt가 막은 주소는 건너뛰어요. 앱스토어 리뷰 RSS는 robots.txt가 막고 있어 '붙여 넣기'로 넣어요" }
  - { key: subs, label: 서브레딧, type: lines, placeholder: "smallbusiness", hint: "해외 해결·수익 근거용. 비밀값(Reddit 앱)을 넣어야 모아요" }
  - { key: daily_limit, label: 하루에 모을 글 수, default: "20", hint: "한 번에 AI가 읽는 글 수예요. 50개까지" }
  - { key: skills, label: 내가 만들 수 있는 것, type: lines, default: "웹\n자동화 스크립트\nAI 에이전트", hint: "'내가 만들 수 있나' 점수에 써요" }
  - { key: avoid, label: 피하고 싶은 것, type: lines, default: "오프라인 영업\n하드웨어", hint: "이게 꼭 필요한 문제는 '범위 밖'으로 빠져요" }
  - { key: week_hours, label: 일주일에 쓸 수 있는 시간, default: "10", hint: "첫 버전이 이 시간 × 8주를 넘으면 점수를 깎아요" }
  - { key: weights, label: 점수 비중, default: "35,20,20,15,10", hint: "돈 신호, 반복, 자동화 가능도, 내가 만들 수 있나, 고통 순서. 쉼표로 적어요" }
  - { key: filter, label: 문제 묶음 보기, default: "전체", hint: "'보기 바꾸기'로 고르면 바뀌어요. 예: 분야:교육, 출처:크몽, 단계:검증, 범위 밖" }
---

매일 한 번 RSS(국내 커뮤니티)와 Reddit 공식 API에서, 또는 붙여 넣은 글에서 사람들의 문제(병목·불만·요청)를 모아 분야와 점수를 붙이고, 비슷한 것끼리 묶어요. 점수 상위 묶음은 해결 카드(대행 → 도구 → 제품, 수익 구조, 이번 주 검증 한 걸음)를 AI가 만들어요. 검증 결과를 적으면 점수가 실제 반응대로 바뀌고, 결제가 나오면 공사(자동화) → 건물(월 순이익 5만원 이상, 손 월 1시간 이하)로 올라가요. 마음에 드는 묶음은 [프로젝트 파일럿으로 넘기기]로 #설계 카드를 만들어요.

원문은 저장하지 않아요. 요약·분야·점수·원글 주소만 남겨요. 원글 작성자에게 자동으로 연락하지 않고, 연락 문구는 [문구 복사]로 직접 보내요.
