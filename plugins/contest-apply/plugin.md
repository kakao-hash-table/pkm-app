---
pkm_plugin: 1
id: contest-apply
name: 공모전 신청
version: 0.8.1
author: pkm
permissions:
  ai: [chat, agent]
  agent_mode: read
  browser: true
  bundled: [scripts/contest.mjs, scripts/engine.mjs, scripts/sources.mjs, scripts/hwp.mjs, scripts/docs.mjs, scripts/mail.mjs, scripts/forms.mjs]
  secrets:
    - { name: NAVER_ID, label: 네이버 아이디, optional: true, plain: true, hint: "메일로 받는 공모전을 이 계정으로 보내요. @naver.com 앞부분만 적어요" }
    - { name: NAVER_APP_PASSWORD, label: 네이버 애플리케이션 비밀번호, optional: true, hint: "네이버 로그인 비밀번호가 아니에요. 네이버 › 보안설정 › 2단계 인증 › 애플리케이션 비밀번호에서 만들고, 네이버 메일 › 환경설정 › POP3/SMTP 설정에서 'SMTP 사용'을 켜야 보내져요", url: "https://nid.naver.com/user2/help/myInfoV2?m=viewSecurity" }
logins:
  - { name: 구글, url: "https://accounts.google.com/" }
  - { name: 네이버, url: "https://nid.naver.com/nidlogin.login" }
settings:
  - { key: birth, label: 생년월일, default: "", placeholder: "1990-05-01", hint: "연도만 적어도 돼요. '만 29세 이하'처럼 경계에 걸리면 '조건 확인'으로 보여요" }
  - { key: gender, label: 성별, default: "", placeholder: "남", hint: "'여성만' 같은 조건을 거를 때 써요" }
  - { key: home, label: 사는 곳, default: "", placeholder: "서울특별시 종로구", hint: "시·군까지 적어요. '○○시 거주자' 조건에 써요" }
  - { key: work, label: 다니는 곳, default: "", placeholder: "경기도 성남시", hint: "직장이나 학교가 있는 시·군. '거주·재직·재학' 조건이면 여기도 봐요" }
  - { key: status, label: 신분, default: "", placeholder: "직장인", hint: "'대학생만' 같은 조건을 거를 때 써요" }
  - { key: fields, label: 찾을 분야, type: lines, default: "네이밍\n슬로건", hint: "한 줄에 하나. 사이트의 네이밍·슬로건 분야에서 찾고, AI가 요강을 읽어 이 분야 작품을 받는지 봐요" }
  - { key: site_wevity, label: 위비티에서 찾기, type: toggle, default: true }
  - { key: site_thinkgood, label: 씽굿에서 찾기, type: toggle, default: true }
  - { key: site_contestkorea, label: 콘테스트코리아에서 찾기, type: toggle, default: true }
  - { key: site_linkareer, label: 링커리어에서 찾기, type: toggle, default: true }
  - { key: draft_count, label: AI 안 개수, default: "5", hint: "공모전마다 만들 안 수예요(10개까지). 1인 응모 건수만큼 '추천'을 붙여요" }
  - { key: prompt, label: AI에게 더할 말, type: lines, default: "", placeholder: "예: 4글자 안팎으로, 영어는 섞지 말고", hint: "AI 안을 만들 때마다 함께 보내요" }
  - { key: mail_auto, label: 확인 없이 메일 보내기, type: toggle, default: false, hint: "켜면 [제출 준비]가 메일 접수 공모전을 묻지 않고 AI가 추천한 안으로 보내요(보낼 안을 직접 고르려면 꺼 둬요). AI 작품 제한·조건 확인·신청서 빈칸·뜻풀이 글자 초과·마감 지남이면 켜 두어도 묻고 보내요. 처음 한 번은 확인창으로 보내 본 뒤에야 확인 없이 보내요(계정 설정이 맞는지 보려고)" }
  - { key: full_auto, label: 완전 자동화, type: toggle, default: false, hint: "켜면 아래 '확인 없이 메일 보내기'·'확인 없이 폼 제출하기'·'동의 문항은 묻지 않고 동의로 답하기'를 모두 켠 것과 같아요. 플러그인 화면의 '완전 자동화' 칸에서 켜고 끌 수도 있어요. 내 정보가 모자라거나 직접 내야 하는 접수(로그인·파일 올리기 폼, 홈페이지)처럼 걸리는 것이 있을 때만 물어봐요" }
  - { key: form_auto, label: 확인 없이 폼 제출하기, type: toggle, default: false, hint: "켜면 [제출 준비]가 구글 폼·네이버 폼 접수 공모전을 묻지 않고 AI가 추천한 안으로 제출해요. '폼 제출 시험'을 통과한 종류의 폼만, 그리고 로그인·파일 올리기·빈 필수 문항·글자 초과·AI 작품 제한·조건 확인이 없을 때만이에요. 하나라도 걸리면 켜 두어도 물어봐요" }
  - { key: consent_auto, label: 동의 문항은 묻지 않고 동의로 답하기, type: toggle, default: true, hint: "켜면 양식의 동의 표시와 폼의 필수 동의·서약 문항(유의사항 확인, 개인정보 수집·이용, 저작권, 참가 서약)을 묻지 않고 '동의'로 답해요. 필수가 아닌 홍보·마케팅 수신 동의는 켜 두어도 답하지 않아요. 무엇에 동의했는지는 제출 화면의 폼 답에 남아요" }
  - { key: me, label: 제출용 내 정보, type: pairs, default: "이름\t\n연락처\t\n이메일\t", columns: [{ label: 항목, placeholder: 이름 }, { label: 값, placeholder: 홍길동 }], hint: "양식(신청서·동의서) 채우기·메일 본문·[문구 복사]에 써요. AI에게 보내지 않아요. 여기 없는 항목은 제출 준비에서 물어보고 내 프로필 데이터(내정보.json)에 기억해요. 여기 적은 값이 먼저이고, 적은 값은 데이터에 옮겨 다른 기기와 맞춰요" }
---

하루 한 번 위비티·씽굿·콘테스트코리아·링커리어의 네이밍·슬로건 공모전을 찾아, AI가 요강을 읽고 상금·낼 것·조건·발표일을 정리해요. 내 조건으로 낼 수 있는 것만 '낼 공모전'에 올려요.

[제출 준비]를 누르면 AI 안을 만들고, 주최가 준 양식(.hwp·.hwpx — 모음 사이트와 주최 홈페이지 공고의 첨부)을 받아 신청서·동의서를 채워 화면에서 미리 보여요. 양식에 필요한데 없는 내용과 동의 표시는 물어봐요. 문서 폴더의 '공모전 서류'에 `도장.png`를 두면 서명·날인 자리에 넣어요.

메일로 받는 공모전은 네이버 메일(애플리케이션 비밀번호)로 보낼 수 있어요. 보낼 안을 고르고, 받는 사람·제목·본문·첨부를 확인한 뒤 [메일 보내기]를 눌러야 보내요. 자필 서명한 스캔이나 PDF처럼 직접 만든 파일은 '보탤 파일' 폴더에 넣으면 함께 붙여요.

구글 폼·네이버 폼으로 받는 공모전은 폼 문항을 읽어 AI가 문항마다 답을 짜요. 동의·서약 문항은 어떻게 답할지 물어보고, 제출 화면에서 문항별 답을 모두 확인한 뒤 [폼 제출하기]를 눌러야 내요. 폼 제출은 되돌릴 수 없어서, 맨 아래 '폼 제출 시험'에서 내가 만든 시험 폼으로 한 번 보내 보고 답이 제대로 들어간 걸 확인해야 버튼이 켜져요. 
홈페이지로 받는 공모전과, 로그인·파일 올리기가 필요한 폼은 [AI가 브라우저로 내기]로 낼 수 있어요. AI가 pkm 전용 브라우저에서 접수 화면을 읽고, 칸을 채우고, 제출해요. 내 정보는 AI에게 보이지 않게 프로그램이 넣고, 로그인·회원가입·본인 인증·캡차가 나오면 멈추고 화면의 브라우저에서 직접 하게 넘겨요. 구글·네이버는 '브라우저 로그인'에서 한 번 로그인해 두면 다음부터 이어 써요.

내 조건(생년·성별·사는 곳·신분)과 제출용 내 정보, 채운 서류, 도장은 내 프로필 데이터(`_플러그인/.data/contest-apply/`)에 두어 다른 기기와 함께 동기화해요. 설정에 적으면 데이터에 옮겨 두고, 설정이 빈 기기에서는 데이터의 값으로 채워요. 제출용 내 정보는 AI에게 보내지 않아요 — AI는 어느 자리에 무엇을 넣을지만 정하고, 내 정보는 스크립트가 넣어요.
