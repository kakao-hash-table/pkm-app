---
pkm_plugin: 1
id: dev-tools
name: 개발 도구
version: 0.5.0
author: pkm
permissions:
  ai: [agent]
  agent_mode: auto
  bundled: [scripts/projects.mjs, scripts/devserver.mjs, scripts/agents.mjs, scripts/domain-proxy.mjs]
settings:
  - { key: projects, label: 프로젝트, type: lines, placeholder: "~/code/*", hint: "한 줄에 폴더 하나, 또는 프로젝트 폴더들이 모인 폴더를 폴더/*로 적어요" }
  - { key: fe_group, label: FE 프로젝트 노트 묶음, default: "FE 프로젝트", hint: "FE 프로젝트 관리 플러그인이 만든 맥락노트 묶음. 노트의 로컬 폴더를 프로젝트로 더하고, 실행 명령으로 띄워요. 비우면 보지 않아요" }
  - { key: domain_proxy, label: domain-proxy.js 위치, default: "~/Downloads/dkos3-nginx-master/domain-proxy.js", hint: "fedev 도메인을 로컬 포트로 잇는 domain-proxy.js. 프로젝트 포트를 이 파일의 ROUTES에서 권하고, 프록시 포트(PROXY_PORT)는 피해요. 비우면 쓰지 않아요" }
  - { key: legacy_ports, label: 기존 웹 포트 설정, default: "~/Documents/obsidian-sync/_web/data/cc-run-ports.json", hint: "기존 웹에서 기억한 포트를 초기값으로 가져와요. 읽기만 하며, 이후 선택은 개발 도구가 기억해요. 비우면 가져오지 않아요" }
  - { key: agent_dirs, label: 에이전트 폴더, type: lines, default: "~/.claude/agents", hint: "Claude Code 에이전트(.md)가 있는 폴더. 한 줄에 하나. 노트 폴더의 .claude/agents도 적을 수 있어요" }
---

내 컴퓨터의 프로젝트에서 개발 서버를 버튼 한 번으로 띄우고 멈춰요. FE 프로젝트 관리 플러그인의 노트가 있으면 그 레포들도 목록에 오고, 노트의 실행 명령으로 띄우고 배포·브랜치 전략을 한 줄로 보여요. 고칠 것을 적으면 AI가 프로젝트를 고치고, 사용성 점검을 맡기면 화면 코드를 읽고 문제를 짚어 줘요. domain-proxy(fedev 도메인 → 로컬 포트)를 등록하고 띄우고 멈추며, 도메인과 포트를 고쳐요. Claude Code 에이전트 파일도 같은 방식으로 고쳐요. AI는 커밋과 push를 하지 않아요. 결과는 내가 확인해요.
