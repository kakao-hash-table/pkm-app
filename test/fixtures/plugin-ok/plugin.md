---
pkm_plugin: 1
id: deploy-loop
name: 배포 루프
version: 0.1.0
author: example
collects: { tag: deploy }
permissions:
  ai: [chat, agent]
  agent_mode: read
  scripts: [jira]
  bundled: [scripts/pr-body.mjs]
settings:
  - { key: jira_project, label: 지라 프로젝트 키 }
---

지라 착수부터 PR, 리뷰까지 한 카드에서 진행해요.
