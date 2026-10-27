---
pkm_plugin: 1
id: flow-demo
name: 흐름 시험
version: 0.1.0
permissions:
  bundled: [scripts/list.mjs, scripts/pick.mjs]
  secrets: [DEMO_TOKEN]
settings:
  - { key: items, label: 항목, default: "A-1" }
---
시험용 — 목록 가져오기, 자동 시작, 묻고 답하기, 사람 확인.
