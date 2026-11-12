---
pkm_plugin: 1
id: web-submit
name: 홈페이지 내기 시험
version: 0.1.0
permissions:
  ai: [agent]
  agent_mode: read
  browser: true
  bundled: [scripts/list.mjs, scripts/prep.mjs, scripts/after.mjs, scripts/again.mjs]
logins:
  - { name: 구글, url: "https://accounts.google.com/" }
  - { name: 네이버, url: "https://nid.naver.com/nidlogin.login" }
---
시험용 — 브라우저 단계(내 정보·갈 수 있는 곳·올릴 파일), 넘겨받기, 구조화 결과, 미리 로그인, 단계 되돌리기(again).
