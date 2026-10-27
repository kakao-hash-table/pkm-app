---
pkm_plugin: 1
id: dev-tools
name: 개발 도구
version: 0.1.0
author: pkm
permissions:
  ai: [agent]
  agent_mode: auto
  bundled: [scripts/projects.mjs, scripts/devserver.mjs, scripts/agents.mjs]
settings:
  - { key: projects, label: 프로젝트, type: lines, placeholder: "~/code/*", hint: "한 줄에 폴더 하나, 또는 프로젝트 폴더들이 모인 폴더를 폴더/*로 적어요" }
  - { key: agent_dirs, label: 에이전트 폴더, type: lines, default: "~/.claude/agents", hint: "Claude Code 에이전트(.md)가 있는 폴더. 한 줄에 하나. 노트 폴더의 .claude/agents도 적을 수 있어요" }
---

내 컴퓨터의 프로젝트에서 개발 서버를 띄우고 멈춰요. 고칠 것을 적으면 AI가 프로젝트를 고치고, 사용성 점검을 맡기면 화면 코드를 읽고 문제를 짚어 줘요. Claude Code 에이전트 파일도 같은 방식으로 고쳐요. AI는 커밋과 push를 하지 않아요. 결과는 내가 확인해요.
