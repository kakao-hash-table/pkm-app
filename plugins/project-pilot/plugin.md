---
pkm_plugin: 1
id: project-pilot
name: 프로젝트 파일럿
version: 0.3.0
author: pkm
permissions:
  ai: [chat, agent]
  agent_mode: auto
  bundled: [scripts/pilot.mjs, scripts/engine.mjs, scripts/store.mjs]
settings:
  - { key: workspace, label: AI 작업 폴더, type: path, default: "~/pkm-projects", hint: "프로젝트마다 이 아래에 폴더를 하나 만들어, AI가 초안·조사·운영 도구를 여기에 둬요. 노트 폴더 밖이에요" }
  - { key: auto_build, label: 설계를 확인하지 않고 바로 만들기, type: toggle, default: false, hint: "켜면 설계 검토에서 멈추지 않고 카드까지 만들어요. 처음엔 꺼 두기를 권해요" }
---

목표를 한 줄로 맡기면, AI가 조사하고 오퍼·고객유치·홍보·전환·운영툴·리텐션·측정·규정 중 필요한 서브 프로젝트로 나눠 단기 카드로 만들어요. 숫자는 장기에 쌓이고, 설계는 맥락노트에 남아요. 정한 때마다 AI가 루프(오늘 올릴 글 초안, 소재 찾기, 주간 점검)를 돌려 '오늘 할 것'에 올리고, 나는 복사해 올리거나 숫자를 적는 짧은 일만 해요.

외부 계정에 AI가 직접 글을 올리지 않아요. 광고·제휴 표기와 플랫폼 규칙을 지키고, 수익을 약속하지 않아요. AI는 이 컴퓨터의 작업 폴더에서만 파일을 만들고, 카드·노트는 플러그인 스크립트가 만들어요.
