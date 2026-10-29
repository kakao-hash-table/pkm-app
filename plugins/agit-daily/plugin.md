---
pkm_plugin: 1
id: agit-daily
name: 아지트 데일리
version: 0.1.0
author: pkm
permissions:
  bundled: [scripts/daily.mjs]
settings:
  - { key: tag, label: 태그 앞 이름, default: "hash", hint: "#hash202610처럼 월 태그와 주차 태그(#hash20261005)를 붙여요. 비우면 태그를 넣지 않아요" }
  - { key: jira_url, label: 지라 주소, default: "https://kakao.atlassian.net/browse/", hint: "카드 제목의 지라 키(MPEN-1210 등)를 이 주소 링크로 바꿔요. 비우면 링크 없이" }
  - { key: agit_url, label: 데일리 올리는 아지트 그룹 주소, default: "", placeholder: "https://kakao.agit.in/g/…", hint: "적으면 글 옆에 [아지트 열기] 링크가 생겨요(선택)" }
---

아지트에 올릴 데일리 글을 만들어요. 한 일은 직전 근무일(주말·쉬는 날은 건너뜀)의 약속과 데일리노트 계획, 할 일은 오늘 약속과 계획이에요. 진행 중 카드도 버튼 하나로 할 일에 더할 수 있고, 이슈에는 오늘 요일과 다가오는 쉬는 날 두 개를 적어요. [문구 복사]로 복사해 아지트에 붙여 넣으면 돼요.
