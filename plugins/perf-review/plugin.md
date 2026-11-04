---
pkm_plugin: 1
id: perf-review
name: 성과 평가 글
version: 0.2.0
author: pkm
permissions:
  ai: [chat]
settings:
  - { key: main_note, label: 주요 업무 노트 제목, placeholder: "예: 2026년 마이노트 - 주요 업무(제출용)", hint: "맥락노트나 영구노트 제목 그대로. 항목마다 ## 제목, 본문, 그리고 (글자 수자) 줄이 있는 노트예요" }
  - { key: tasks_note, label: 과제 노트 제목, placeholder: "예: 2026년 마이노트 - 성과 기반 정리", hint: "'## 과제 관리' 아래 #### 과제마다 '실행 계획 및 내용' 줄과 '- 협업 동료:' 줄이 있는 노트예요" }
  - { key: rubric_prefix, label: 점수 기준 노트 제목 앞부분, placeholder: "예: 2026년 성과 - ", hint: "이 말로 시작하는 맥락노트마다 점수 항목 하나가 돼요. '2026년 성과 - 전문성'이면 항목 이름은 '전문성'이에요" }
  - { key: form_note, label: 제출 화면 노트 제목, placeholder: "예: 마이노트 html", hint: "체크인 노트 작성 화면을 저장한 HTML이 든 노트. 지난 공유본과 지금 글을 견줄 때 써요. 비워도 돼요" }
  - { key: rules_note, label: 작성 규칙 노트 제목, placeholder: "예: 성과관리 AI 작성 규칙", hint: "AI가 글을 쓸 때 꼭 지킬 내 규칙을 적은 노트. 비워도 돼요" }
---

체크인 노트(마이노트)에 낼 주요 업무와 과제를 한 화면에서 고쳐요. 제출 화면과 같은 순서로 미리 보고 칸마다 복사하고, 성과 기준 노트로 점수를 매기고, 단기 카드에서 [올해 성과로 넣기]를 누르면 AI가 들어갈 과제와 문장 초안을 골라 줘요. AI 문체(가운뎃점, 대시, 화살표, 과장 부사, 번역투)는 저장 전에 짚어 줘요.
