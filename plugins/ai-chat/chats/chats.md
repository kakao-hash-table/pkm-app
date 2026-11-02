## 데이터 관리
이 프로필의 노트·단기·장기·루틴·약속·기록을 대화로 더하고 고치고 지워요. 고친 것은 화면에 바로 반영돼요.
- scope: profile
- mode: full
- prompt: prompts/data.md

## 카드 작업
단기 카드마다 세션 하나. 프로젝트 일이면 채팅 창에서 작업 폴더를 골라 그 폴더에서 해요. 세션끼리는 동시에 돌아요.
- scope: card
- mode: full
- prompt: prompts/card.md
- cwd: {card_cwd}
- label: AI Chat

## 프로젝트 작업
프로젝트 파일럿 프로젝트마다 세션 하나. 단기 보드의 프로젝트 묶음 카드에서 열어요. 처음엔 그 프로젝트의 AI 작업 폴더에서 해요.
- scope: project
- mode: full
- prompt: prompts/project.md
- label: AI Chat
