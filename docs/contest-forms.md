# 공모전 신청 — 구글 폼·네이버 폼 문항 유형과 설정

`plugins/contest-apply/scripts/forms.mjs`가 구글 폼·네이버 폼에서 만들 수 있는 문항과 설정을 어떻게 읽고, 답을 어떤 꼴로 받고, 제출 때 무엇을 보내는지 적은 문서다. 테스트는 `test/contest-forms.test.mjs`.

- **실제 폼에 제출(POST)해 본 적은 없다.** 문항 읽기(GET)만 실제 서버로 했고, 제출은 가짜 서버로만 시험했다. 그래서 '제출 때 보내는 꼴'은 모두 실서버 미검증이다(맨 아래 목록).
- 근거 표기
  - **표본**: 실제 폼을 GET으로 읽어 둔 fixture(`test/fixtures/contest/form-*.{html,json}`)에서 확인. 구글 fixture 가운데 `form-google-kspo.html`·`form-google-lib.html`은 화면 전체이고, 나머지는 공개 폼에서 문항 데이터(`FB_PUBLIC_LOAD_DATA_`)·form 태그·상태 속성·숨은 입력만 남긴 것이다.
  - **코드**: 네이버 폼 웹 클라이언트 `nform` 2.10.5(`index.js`)의 컴포넌트 코드에서 확인. 괄호 안 숫자는 파일 안 글자 위치(대략).
  - **추정**: 표본도 코드도 없이, 널리 알려진 방식이나 이름·순서로 미룬 것.
- 지원 표기: **자동** = 읽기·답 검사·제출까지 / **답만** = 문항과 답 꼴은 알려 주지만 제출은 사람이 직접(폼 전체가 `blockers`에 걸린다) / **안 받음** = 답을 받지 않는 항목.

## 답을 쓰는 꼴 (AI·사람이 쓰는 글)

답은 모두 글 하나 또는 글 배열이다. 여러 개 고르는 유형과 표는 한 글에 줄마다 하나씩 써도 된다.

| 우리 type | 답 | 예 |
|---|---|---|
| `short` · `long` | 글. 단답은 줄바꿈이 한 칸 띄움으로 바뀐다 | `함께 뛰는 가치` |
| `short` + `field` | `name` 이름, `phone` 전화(숫자만 남긴다), `email` 이메일(공백을 뺀다) | `010-1234-5678` |
| `choice` · `dropdown` | 보기 글 하나. `other: true`면 보기에 없는 글 하나를 직접 입력으로 받는다 | `예` |
| `multi` | 보기 글 여러 개(배열 또는 줄마다). `other: true`면 직접 입력 하나까지 | `['바다', '과학']` |
| `scale` | 보기 글 하나(점수) | `4`, 네이버 별점 `4.5` |
| `agree` | 보기 글 하나 | `동의`, `동의합니다` |
| `grid` | 줄마다 `행 글 :: 열 글`. `many: true`면 같은 행을 여러 줄 | `롤 :: 피구` |
| `category` | 보기 글 `대분류·소분류`. `many: true`면 여러 개 | `문학·시` |
| `date` | `2026-11-10`. 연도 없는 구글 날짜는 `11-10`도 된다 | |
| `time` | `14:30` | |
| `datetime` | `2026-11-10 14:30` (`T`로 이어도 된다) | |
| `duration` | `시:분:초` | `1:30:00` |
| `number` | 숫자 글. 쉼표·공백은 뗀다 | `1234567`, `-12.5` |
| `address` | `(우편번호) 도로명주소 \| 상세주소`. 우편번호를 빼면 제출 직전에 네이버 주소 검색으로 하나로 정해질 때만 보낸다 | `(04524) 서울특별시 중구 세종대로 110 \| 3층` |
| `file` · `other` | 답을 받지 않는다(사람이 폼에서 직접) | |

문항에는 `rule`(사람이 읽을 제약 한 줄, 없으면 `''`)이 붙는다. 글자 수 상한은 `limit`에, 그 밖의 제약(숫자 범위, 고를 개수, 척도 양끝 라벨, 정규식 등)은 `rule`에 있다. 표에는 `rows`(행 글)와 `many`가 붙고 열은 `options`다.

## 구글 폼

문항은 viewform HTML의 `FB_PUBLIC_LOAD_DATA_`(아래 `d`)에서 읽는다. 항목은 `d[1][1]`의 `[id, 제목, 설명, 유형, [[entryId, 보기, 필수, 라벨, 검증, …]], 섹션 이동]`. 아래 `e`는 항목의 첫 entry다.

### 문항 유형

| 화면 이름 | 유형 번호·칸 | 우리 type | 제출 때 보내는 꼴 | 지원 | 근거 |
|---|---|---|---|---|---|
| 단답형 | 0 | `short` | `entry.<id>=글` | 자동 | 표본(kspo) |
| 장문형 | 1 | `long` | `entry.<id>=글`(줄바꿈은 CRLF) | 자동 | 표본(kspo) |
| 객관식 질문 | 2, 보기 `e[1]`=`[글, , 이동, , 기타 여부]` | `choice` | `entry.<id>=보기 글` | 자동 | 표본(kspo·lib) |
| 드롭다운 | 3 | `dropdown` | `entry.<id>=보기 글` | 자동 | 표본(grid, grid-radio) |
| 체크박스 | 4 | `multi` | 같은 이름을 고른 수만큼 반복 | 자동 | 표본(kspo·scale-email) |
| 기타(직접 입력) 보기 | 보기의 `[4]===1` | `other: true` | `entry.<id>=__other_option__` + `entry.<id>.other_option_response=글` | 자동 | 칸은 표본(number·scale-email), 보내는 꼴은 추정 |
| 선형 배율 | 5, 보기 `[["1"],…]`, 양끝 라벨 `e[3]` | `scale` (`rule`: `1(낮음)~5(높음)`) | `entry.<id>=값` | 자동 | 칸은 표본(scale-email), 보내는 꼴은 추정 |
| 평점(별·하트 등) | 18 | `scale` | `entry.<id>=값` | 자동(보기가 읽힐 때만, 아니면 `other`) | 추정 — 표본 없음 |
| 객관식 그리드 | 7, 행마다 entry 하나: `[행 entryId, 열 보기, 필수, [행 글], …, [0]]` | `grid`, `many: false` | 행마다 `entry.<행 id>=열 글` | 자동 | 칸은 표본(grid·grid-radio, 숨은 입력 `entry.<행 id>_sentinel`), 보내는 꼴은 추정 |
| 체크박스 그리드 | 7, 행 entry 끝 `e[11]`=`[1]` | `grid`, `many: true` | 같은 행 이름을 반복 | 자동 | 추정 — 표본은 `[0]`과 칸이 없는 옛 폼뿐 |
| 날짜 | 9, `e[7]`=`[시간 포함, 연도 포함]` | `date` | `entry.<id>_year` · `_month` · `_day`(0을 채우지 않는다) | 자동 | 칸 `[0,1]`은 표본(lib 등 6개), 보내는 꼴은 추정 |
| 날짜(연도 없이) | 9, `e[7][1]===0` | `date` (`rule`: 연도 없이 월-일만) | `_month` · `_day` | 자동 | 추정 |
| 날짜 + 시간 | 9, `e[7][0]===1` | `datetime` | 위에 `_hour` · `_minute` | 자동 | 추정 |
| 시간(시각) | 10 | `time` | `entry.<id>_hour` · `_minute` | 자동 | 추정 — 표본 없음 |
| 시간(걸린 시간) | 10, `e[6][0]===1` | `duration` | `_hour` · `_minute` · `_second` | 자동 | 추정 — 표본 없음 |
| 파일 업로드 | 13 | `file` | (올리지 않는다) | 답만 — 구글 로그인과 파일 올리기가 필요하다 | 추정 — 표본 없음 |
| 제목 및 설명 | 6 | — | — | 안 받음 | 표본 |
| 섹션 | 8 | 페이지 나눔(`page`) | `pageHistory` | 자동 | 표본 |
| 이미지 · 동영상 | 11 · 12 | — | — | 안 받음 | 11은 표본(lib), 12는 추정 |
| 그 밖의 번호 | | `other` | | 답만 | |

### 문항 설정

| 설정 | 칸 | 우리가 하는 일 | 근거 |
|---|---|---|---|
| 필수 | `e[2]===1`(그리드는 행마다) | `required`. 그리드는 한 행이라도 필수면 모든 행을 채우게 한다 | 표본 |
| 보기 순서 무작위 | 확인 못 함 | 보기 글로 보내므로 영향 없음 | 추정 |
| 응답 검증 | `e[4]`=`[[종류, 조건, [값], 오류 글]]` | `rule`에 글로, `checkAnswers`에서 검사 | 아래 |
| 숫자 검증 | 종류 1: 조건 1 초과 · 2 이상 · 3 미만 · 4 이하 · 5 같음 · 6 다름 · 7 사이 · 8 사이 아님 · 9 숫자 · 10 정수 | `rule` 예 `숫자 1~100`, `정수` | 9는 표본(number), 나머지 번호는 추정(편집 화면 순서) |
| 텍스트 검증 | 종류 2: 100 포함 · 101 포함 안 함 · 102 이메일 · 103 URL | `rule` 예 `이메일 꼴` | 102는 표본(validation), 나머지 추정 |
| 정규 표현식 | 종류 4: 299 포함 · 300 포함 안 함 · 301 일치 · 302 일치 안 함 | `rule` 예 `정규식 …에 맞게`. 300자를 넘거나 깨진 식은 검사하지 않고 서버에 맡긴다 | 추정 |
| 길이 | 종류 6: 202 최대 글자 수 · 203 최소 글자 수 | 최대는 `limit`, 최소는 `rule` | 202는 표본(kspo), 203 추정 |
| 체크박스 개수 | 종류 7: 200 최소 · 201 최대 · 204 정확히 | `rule` 예 `2개 이상 고르기` | 추정 |
| 모르는 검증 | | 폼에 적힌 오류 글을 `rule`에 넣고 검사는 서버에 맡긴다 | |
| 답변을 기준으로 섹션 이동 | 보기의 `[2]`: 없음·-2 다음, -3 제출, 그 밖은 섹션 항목 id | `visible()`이 따라간다 | 표본(nav-nugu·nav-wepick·grid·lib) |
| 섹션 뒤 이동 | 섹션 항목의 `[5]`: **그 섹션 앞 페이지를 마친 뒤** 어디로 갈지 | `visible()`이 따라간다 | 표본 — 분기 있는 실제 폼 3개의 흐름이 이 해석과 맞다 |
| 처음으로 돌아가기(-1), 뒤로 가는 이동, 없는 섹션으로 가는 이동, 한 페이지에 이동 문항 둘 이상 | | `blockers` — 순서를 확신하지 못한다 | 추정 |
| 그리드: 열당 응답 1개로 제한 | 확인 못 함 | 검사하지 않는다(어기면 서버가 거절) | 표본 없음 |

### 폼 설정

`d[1][10]`이 응답 설정 배열이다. 표본 40개(공개 폼 37개 + kspo·lib·me)로 화면 표시와 맞춰 봤다.

| 설정 | 칸 | 우리가 하는 일 | 근거 |
|---|---|---|---|
| 진행률 표시줄 | `[0]===1` | 쓰지 않는다 | 표본(1인 6개 모두 화면에 '1/3페이지') |
| 응답 1회 제한(로그인 필요) | `[1]===1`, `d[18]===1`, 화면의 `data-sign-in-to-continue="true"` | `login: true` | 표본(signin·lib 등 3개에서 셋이 함께 켜지고, 나머지에서는 모두 꺼져 있다) |
| 이메일 수집 안 함 | `[6]===1` | — | 표본 |
| 이메일 수집 — 확인된 계정 | `[6]===2` | `login: true` | 표본(lib 1개) |
| 이메일 수집 — 응답자 입력 | `[6]===3` | 맨 앞에 필수 문항 q1(`field: 'email'`)을 넣고 `emailAddress=`로 보낸다 | 칸은 표본(8개 모두 화면에 이메일 입력 칸), 보내는 이름은 추정 |
| 설정을 읽지 못함 | 배열이 없거나 `[6]`이 1·3이 아님 | 보수적으로 `login: true` | |
| 응답 사본 전송 | `[3]`(1·2·3) 추정 | 쓰지 않는다 | 추정 |
| 응답 수정 허용 · 다른 응답 제출 링크 | `d[1][2]`=`[확인 메시지, 다른 응답 링크, , 수정 허용, ]` 추정 | 확인 메시지 첫 줄만 제출 성공 판정에 쓴다 | 추정 |
| 사람 확인(캡차) | 화면의 `data-should-execute-invisible-captcha-on-form-submit="true"` | `blockers` — 넘지 않는다 | 표본(captcha 등 2개) |
| 응답받기 중지 | viewform이 302로 `/closedform`에 가고 문항 데이터가 없다 | `open: false`, `closed` | 표본(closed) |
| 폼을 보려면 로그인(조직 전용 등) | viewform이 google.com 로그인으로 302 | `{ error, reason: 'login' }` | 추정 |
| 퀴즈 | 확인 못 함 | 알아채지 못한다. 문항은 보통 폼과 같게 읽힌다 | 표본 없음 |
| 질문 순서 무작위 | 확인 못 함 | 영향 없음 | 추정 |

### 제출

`POST https://docs.google.com/forms/d/e/<id>/formResponse`, `application/x-www-form-urlencoded`. 거치는 문항의 `entry.*`와 `fvv=1`, `partialResponse=[null,null,"<fbzx>"]`, `pageHistory`(실제로 거친 페이지, 0부터 — 예 `0,2,3`), `fbzx`, viewform에서 받은 쿠키. 성공은 200이면서 폼 화면이 아니고 확인 문구가 보일 때만 `sure: true`.

## 네이버 폼

문항은 `GET https://survey-api.naver.com/api/form/surveys/<id>/access?ignoreCount=true`의 JSON에서 읽는다(`pages[].questions[]`). 제출 item은 유형과 상관없이 `{ questionId, type, refId, value }`이고, 글 답은 `refId: null`, 보기를 고른 답은 `refId: 보기(item) id`다. 화면은 `refId`가 없는 값을 보내기 전에 여러 칸 띄움을 한 칸으로, 빈 줄 3개 이상을 2개로 줄인다(코드 613,300).

### 문항 유형

`nform`의 유형→컴포넌트 표(`H$`, 코드 1,015,500)에 있는 22개 전부다.

| 화면 이름 | type · 읽는 props | 우리 type | 제출 item의 value | 지원 | 근거 |
|---|---|---|---|---|---|
| 주관식 단답형 | `SHORT_TEXT` | `short`(limit 100) | 글 | 자동 | 표본(kind) + 코드 `UO` 910,300 |
| 주관식 서술형 | `LONG_TEXT` | `long`(limit 2000) | 글 | 자동 | 표본(kind) + 코드 `MO` 909,200 |
| 이름 | `NAME` | `short`, `field: 'name'`(limit 200) | 글 | 자동 | 표본(kind) + 코드 `$O` 971,000 |
| 연락처 | `PHONE_NUMBER` | `short`, `field: 'phone'`(limit 15) | 숫자만 | 자동 | 표본(kind) + 코드 `KO` 969,100 |
| 이메일 | `EMAIL` | `short`, `field: 'email'` | 공백 없는 이메일 | 자동 | 표본(kind) + 코드 `YO` 967,200 |
| 객관식(하나) | `CHOICE`, `items[{id, value, skipOffset}]` | `choice` | `refId: item.id`, value는 보기 글 | 자동 | 표본(kind·cheongju·grid) + 코드 `FO` 911,400 |
| 객관식(복수 선택) | `MULTI_CHOICE`, `props.min/max` | `multi` (`rule`: 고를 개수) | 고른 보기마다 item 하나 | 자동 | 코드 `BO` 917,400 — 표본 없음 |
| 기타(직접 입력) | `options.customValue` | `other: true` | `refId: null`, value는 쓴 글(100자) | 자동 | 코드 `FO`·`BO` |
| 드롭다운 | `DROPDOWN` | `dropdown` | `refId: item.id`, 보기 글 | 자동 | 코드 `ZO` 985,600 — 표본 없음 |
| 선호도(척도) | `LIKERT_SCALE`, items 값 `'1'…`, `props.minValue/maxValue` | `scale` (`rule`: `1(…)~5(…)`) | `refId: item.id`, 값 | 자동 | 코드 `QO` 923,600 — 표본 없음 |
| 별점 | `STAR_RATE`, items 값 `'0.5'…'5'`(`props.half`) | `scale` (`rule`: `별점 0.5~5`) | `refId: item.id`, 값 | 자동 | 코드 `GO` 934,200 — 표본 없음 |
| 표(행마다 하나) | `GRID`, `props.rowHeaders/colHeaders`, items 값 `"행,열"`(1부터) | `grid`, `many: false` | 행마다 `refId: 그 칸의 id`, value `'행 글','열 글'` | 자동 | 표본(grid — 사용자 시험 폼) + 코드 `VO` 929,000 |
| 날짜 | `CALENDAR`, `props.type: DEFAULT` | `date` | 그날 UTC 0시의 epoch ms 글 | 자동 | 코드 `WO` 963,000 — 표본 없음. 한국 시각 브라우저가 만드는 값으로 맞췄다 |
| 날짜 + 시간 | `CALENDAR`, `INCLUDE_TIME` | `datetime` | 한국 시각으로 본 그 시각의 epoch ms 글 | 자동 | 위와 같음 |
| 시간 | `CALENDAR`, `ONLY_TIME` | `time` | 1970-01-01 한국 시각 그 시:분의 epoch ms 글 | 자동 | 위와 같음 |
| 금액/숫자 | `NUMERIC`, `props.prefix/suffix` | `number` (`rule`: 숫자만 · 단위) | 천 단위 쉼표를 넣은 숫자 글(30자) | 자동 | 코드 `HO` 926,200 — 표본 없음 |
| 주관식 단답형(숫자) | `NUMERIC_REAL` | `number` (`rule`: 음수·소수 가능) | 숫자 글(30자) | 자동 | 코드 `eq` 993,700 — 표본 없음 |
| 주소 | `ADDRESS` | `address`(limit 200) | `(우편번호) 기본주소\|상세주소` | 자동 | 코드 `XO` 972,800 · 검색 창 `P$` 976,100 + 주소 검색 응답 1번 확인. 표본 없음 |
| 카테고리형 | `CATEGORY`, `props.categories[{value, next[{value}]}]`, `options.multiSelect`, `props.min/max` | `category` (보기 `대분류·소분류`) | `refId: 값이 같은 item의 id(없으면 null)`, value `대분류·소분류` | 자동(두 단계만) | 코드 `tq` 1,000,000 — 표본 없음 |
| 개인정보 수집/제공 동의(체크) | `AGREE`, `props.items` | `agree`, 보기 `['동의', '동의하지 않음']` | 동의면 `refId: null`, value `'Y'`. 동의하지 않으면 item 없음 | 자동 | 표본(kind) + 코드 `L$` 996,100 |
| 개인정보 수집/제공 동의(동의/미동의) | `AGREE_V2`, items 값 `Y`·`N` | `agree`, 보기 `['동의합니다', '동의하지 않습니다']` | `refId: item.id`, value `'Y'`·`'N'` | 자동 | 표본(cheongju·name) + 코드 `M$` 997,900 |
| 개인정보 수집/처리 위탁 안내 | `INFORM` | — | — | 안 받음 | 코드 `Q$` 1,014,900 |
| 사진 올리기 | `UPLOAD_IMAGE` | `file` | (먼저 `POST /upload/images/answer`로 올려야 한다) | 답만 | 코드 `zO` 937,600 |
| 파일 올리기 | `UPLOAD_FILE` | `file` | (먼저 `POST /upload/files/answer`) | 답만 | 코드 `JO` 988,500 |
| 참여자 정보(네이버 회원 정보) | `AGREE_NVUSER` | `other` | 로그인한 프로필 값 + `extras.profileHash` | 답만 — 네이버 로그인이 필요하다 | 코드 `F$` 1,004,000 |
| 그 밖의 type | | `other` | | 답만 | |

### 문항·폼 설정

| 설정 | 칸 | 우리가 하는 일 | 근거 |
|---|---|---|---|
| 필수 | `options.required` | `required`. 체크형 동의(AGREE)가 필수인데 '동의하지 않음'이면 막는다(화면도 못 낸다) | 표본 + 코드 |
| 보기 순서 섞기 | `options.shuffle` | 영향 없음(보기 id로 보낸다) | 코드 |
| 고를 개수 제한 | `props.min/max`(MULTI_CHOICE·CATEGORY) | `rule`과 `checkAnswers` | 코드 `CA` 618,300 |
| 답에 따라 페이지 이동 | 보기의 `skipOffset`(CHOICE·AGREE_V2 하나 고르기만), 건너뛸 칸 수 | `visible()`이 따라간다. 한 페이지에 여럿이면 뒤 문항이 이긴다 | 코드 `uw` 609,800 — 표본 없음(합성으로 시험) |
| 페이지 뒤 이동 | 페이지의 `nextPageOffset`(1이 다음) | `visible()`이 따라간다. 끝을 넘으면 제출 | 코드 `uw` |
| 건너뛴 페이지의 답 | | 보내지 않는다 | 코드 `xB` 609,500 |
| 1보다 작은 이동 값 | | `blockers` | |
| 로그인 필수 | `options.allowAnonymous !== true` | `login: true` | 표본(값) + 코드 |
| 응답자 지정 | `options.allowedUserIds`, `restricted` | `blockers` | 추정 |
| 중복 응답 · 인원 제한 | `options.allowMultipleResponses`, `maxResponses` | 제출 전 `GET …/answers/status`가 `answered`·`LIMIT_EXCEEDED`를 주면 보내지 않는다 | 코드 `_B` 607,500 |
| 응답 수정 허용 · 결과 공유 · 알림 메일 | `allowEditResponse`, `allowShareMyResponse`, `allowShareSummary`, `sendNotiOnSubmit`, `sendMailOnSubmit` | 쓰지 않는다 | 표본(값) |
| 진행 상태 · 기간 | `status`(IN_PROGRESS·FINISHED·PAUSED…), `startAt`·`endAt` | `status`로 `open`·`closed`. 끝난 설문은 `pages: []`만 온다 | 표본(finished) + 코드 |
| 시작 화면 | `styles.useIntro` | 영향 없음 | 코드 |
| 본인 확인 | 오류 `PII_AUTH` | 넘지 않고 `reason: 'challenge'` | 코드 202,000 |

### 제출

`GET …/surveys/<id>/access`(문항·`taToken`·`anonymous` 쿠키) → `GET …/answers/status` → `POST …/surveys/<id>/answers` 본문 `{ items, taToken, extras: null }`. 헤더는 `origin: https://form.naver.com`, `referer: https://form.naver.com/response/<id>`, access가 준 쿠키. 로그 POST는 보내지 않는다.

## 끝내 자동 제출을 못 하는 것

| 무엇 | 이유 |
|---|---|
| 구글 파일 업로드, 네이버 사진·파일 올리기 | 파일을 먼저 올려야 하고, 구글은 로그인도 필요하다 |
| 네이버 참여자 정보(회원 정보 동의) | 네이버 로그인으로 프로필을 불러와야 한다 |
| 로그인이 필요한 폼(구글 1회 제한·확인된 이메일, 네이버 로그인 필수·응답자 지정) | 로그인을 대신하지 않는다 |
| 캡차·본인 확인이 걸린 폼 | 넘지 않는다 |
| 이동 규칙을 확신하지 못하는 폼(처음으로·뒤로 가는 이동, 구글에서 한 페이지에 이동 문항 둘 이상) | 어느 문항을 거치는지 틀릴 수 있다 |
| 세 단계가 넘는 네이버 카테고리, 행·열 이름이 비었거나 겹치는 표 | 답 글을 한 칸으로 정하지 못한다 |
| 모르는 문항 유형 | 답 꼴을 모른다 |

이런 문항도 `questions`에는 넣어 `type`과 `rule`을 알려 준다. 구글은 `prefillUrl()`로 답을 미리 채운 주소를 줄 수 있다.

## 실서버로 검증하지 못한 가정

구글
1. 모든 페이지의 답을 `formResponse`에 한 번에 보내면 접수된다(브라우저는 페이지마다 보낸다).
2. `pageHistory`에 실제 거친 페이지만 넣으면 건너뛴 페이지의 필수 문항 때문에 거절되지 않는다.
3. 성공·실패 판정(확인 문구, 400, 폼 화면이 다시 옴, `data-validation-failed` 같은 화면 속성).
4. 유형별 보내는 꼴 — 날짜·시간의 `_year/_month/_day/_hour/_minute/_second`, 기타 보기, 표, 척도·평점, `emailAddress`.
5. 표본이 없는 유형·칸 — 평점(18), 시간(10), 파일(13), 체크박스 그리드 표시, 날짜의 시간·연도 칸, 검증 번호 대부분.
6. 줄바꿈을 CRLF로 보내는 것과 그때 서버의 글자 수 계산.
7. `submissionTimestamp`·`tag`·`_sentinel` 숨은 입력을 보내지 않아도 된다.
8. 퀴즈·열당 응답 1개 제한은 알아채지 못한다.

네이버
9. 익명 제출이 access의 `anonymous` 쿠키와 `origin`/`referer`만으로 된다.
10. `ignoreCount=true`로 받은 `taToken`으로 제출할 수 있다.
11. `GET …/answers/status`가 익명에게 200을 준다.
12. 성공 응답 `{ success: true }`와 응답 id 필드 이름.
13. 코드로만 확인한 유형(MULTI_CHOICE, DROPDOWN, LIKERT_SCALE, STAR_RATE, CALENDAR, NUMERIC, NUMERIC_REAL, ADDRESS, CATEGORY)의 서버 쪽 검증.
14. CALENDAR 값을 한국 시각 브라우저 기준으로 만든 것.
15. 주소를 검색 결과에서 고르지 않고 글로 보내도 받는지.
16. 로그 POST를 생략해도 된다.

## 실제 제출로 확인한 것 (2026-11-10, 사용자 시험 폼 "골라골라 시험 테스트")
- 네이버 익명 제출은 `access`가 주는 `anonymous` 쿠키와 `origin`/`referer`만으로 된다. `GET …/answers/status`는 익명에게 200을 준다. 성공 응답은 `{ success: true, available: true, answerId: <숫자>, error: null, surveyStatus: "IN_PROGRESS" }`.
- CHOICE와 GRID의 답 item 꼴(`{ questionId, type, refId, value }`, GRID는 `refId` = 칸 id, `value` = `'행','열'`)이 접수됐다. `type`은 빼도 결과가 같았다.
- **폼을 읽은 직후에 보내면 `{ success: false, error: "INVALID_PARAM" }`으로 거절된다**(기록되지 않음). `ignoreCount` 값과는 무관했고, 읽은 뒤 1.5초·3초·8초에 보낸 것은 모두 접수됐다. 그래서 `pace.naver`(3초)만큼 지난 뒤 보내고, 그래도 거절되면 새로 읽어 한 번 더 보낸다.
- 접수된 답의 내용이 응답 화면에 맞게 보이는지는 사용자가 '폼 제출 시험'에서 확인한다. 구글 폼 제출은 아직 실제로 확인하지 못했다.
