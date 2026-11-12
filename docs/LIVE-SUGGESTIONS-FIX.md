# 한글 입력 중 자동완성 갱신

대상: alpha.10 → alpha.11 · 2026-11-12

## 원인

기존 코드는 compositionstart에서 목록을 닫고, update에서 조합 중이면 다시 닫았습니다. 따라서 `/? 중`처럼 마지막 글자가 아직 IME 조합 상태이면 공백 등으로 조합을 끝내야 목록이 나타났습니다. ProseMirror는 조합 중인 화면 텍스트와 확정된 문서 상태가 일시적으로 다를 수 있어, 확정 문서만 읽는 것도 늦은 갱신의 원인이었습니다.

## 수정

- 조합 중에도 input 이벤트로 목록을 갱신합니다. textarea는 실제 value, ProseMirror는 조합 중 현재 화면 DOM의 텍스트를 추천 검색에 읽습니다.
- compositionupdate가 브라우저의 DOM 수정보다 먼저 도착하는 경우를 위해 다음 화면 갱신에서도 다시 읽습니다. event.data를 본문에 덧붙이지 않습니다.
- 추천 검색 자체는 입력 내용·선택 영역·커서·ProseMirror 상태를 변경하지 않습니다.
- 한글 조합 중 Tab이나 마우스로 고른 항목은 기본 IME 조합을 종료한 뒤 적용합니다. 활성 조합 위에 완성된 텍스트를 덮어써 글자가 중복되는 상황을 피합니다.
- 목록 표시·완성은 채팅 전송을 실행하지 않습니다. alpha.10의 Enter 전송 보호와 Shift+Enter 처리는 유지합니다.
- 자동완성 설정, 미일치, 포커스 이탈과 종료 시 정리도 적용합니다.

## 검증

실시간 목록 회귀 검사 4개는 수정 전 모두 실패하고 수정 후 통과했습니다. 추가로 실제 ProseMirror의 인라인·문단 스키마에서 확정 모델보다 앞선 조합 DOM을 읽는 검사와 안전한 완성 검사 2개를 통과했습니다. 전체 자동 검사는 63개입니다.

검사는 jsdom의 합성 IME 이벤트와 실제 ProseMirror 라이브러리에서 수행했으며 실제 Foundry 서버·OS IME를 실행한 검증은 아닙니다.

## 참고

- https://developer.mozilla.org/en-US/docs/Web/API/Element/compositionupdate_event
- https://developer.mozilla.org/en-US/docs/Web/API/Element/input_event
