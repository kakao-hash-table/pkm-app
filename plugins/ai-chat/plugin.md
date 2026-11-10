---
pkm_plugin: 1
id: ai-chat
name: AI 챗봇
version: 0.3.0
author: pkm
permissions:
  ai: [agent]
  agent_mode: full
  browser: true
settings:
  - { key: card_cwd, label: 작업 폴더를 고를 때 먼저 볼 폴더, type: path, placeholder: "예: ~/cc", hint: "프로젝트를 모아 둔 폴더면 편해요. 비우면 홈 폴더부터 보여요" }
---

오른쪽 아래 채팅 버튼으로 이 프로필의 데이터(노트·카드·기록)를 말로 더하고 고치고 지워요. 행동 › 단기 카드마다 AI Chat 세션을 따로 만들어, 그 카드의 일을 이 컴퓨터에서 여럿 동시에 맡길 수 있어요. 프로젝트 일이면 채팅 창에서 작업 폴더를 골라요.

AI는 이 컴퓨터의 Chrome(pkm 전용 프로필)으로 웹 일도 해요. 로그인이 필요하면 채팅 창에 브라우저 화면을 띄워 직접 로그인해 달라고 하고, [다 했어요]를 누르면 이어서 해요. 한 번 한 로그인은 다음에도 남아요.

pkm 서버와 같은 컴퓨터에 띄운 pkm-ai-server에 연결돼 있을 때만 돌아요. 에이전트는 확인 없이(full) 돌고, 그래도 확인이 필요한 동작은 채팅 창에서 허락하거나 거절해요.
