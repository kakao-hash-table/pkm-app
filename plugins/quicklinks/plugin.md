---
pkm_plugin: 1
id: quicklinks
name: 퀵링크
version: 0.1.0
author: pkm
settings:
  - { key: rules, label: 링크 규칙, type: pairs, default: "[A-Z][A-Z0-9]*-\\d+\\b\thttps://kakao.atlassian.net/browse/$&", columns: [{ label: 정규식, placeholder: "[A-Z]+-\\d+", check: regex }, { label: 연결할 주소, placeholder: "https://kakao.atlassian.net/browse/$&", check: url }], hint: "카드 제목 맨 앞이 정규식에 맞으면 그 부분이 주소로 가는 링크가 돼요. 주소의 $&는 맞은 글자 전체, $1·$2는 정규식에서 괄호로 묶은 부분이에요. 위 줄부터 처음 맞는 규칙을 써요" }
---

단기 카드 제목 맨 앞의 지라 티켓 번호(MPEN-1210 같은)처럼 정해 둔 꼴을 링크로 바꿔요. 규칙은 설정에서 정규식과 연결할 주소를 한 줄씩 더해요. 스크립트도 AI도 쓰지 않아요.
