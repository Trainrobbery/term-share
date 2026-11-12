# 한글 입력 직후 Enter가 줄바꿈이 되는 문제

대상: alpha.9 → alpha.10 · 2026-11-12

## 원인

기존 채팅 입력 코드는 조합 중(`isComposing`, 229 키 코드) 또는 조합 종료 후 80ms 안에 누른 Enter를 `stopImmediatePropagation()`으로 막고 반환했습니다. 이 분기에는 기본 줄바꿈을 취소하는 `preventDefault()`가 없었으며 전송 요청도 저장하지 않았습니다. 따라서 Foundry의 전송 핸들러는 호출되지 않지만 textarea나 contenteditable의 기본 줄바꿈은 실행될 수 있었습니다. Tab으로 다시 완성하면 해당 조합 구간이 지난 뒤 전송할 수 있어 사용자에게 추가 조작이 필요했습니다.

수정 전 코드를 대상으로 합성 이벤트를 실행했을 때, 조합 직후 Enter의 기본 동작 취소, 조합 Enter 뒤 줄바꿈 차단, 최종 입력 후 공유와 실패 알림 경로가 실패하는 것을 확인했습니다. 사용자 OS를 직접 실행해 동일한 키보드 이벤트를 수집한 결과는 아닙니다.

## 변경

- 조합이 끝난 일반 Enter는 기본 줄바꿈과 Foundry의 중복 처리를 취소합니다.
- 조합 중 Enter는 브라우저가 마지막 글자를 확정하도록 허용하면서 전송 의도를 보관합니다.
- 조합 종료와 마지막 input/ProseMirror 상태 변경이 반영된 뒤 짧게 대기(마지막 변경 뒤 30ms)하고 정확한 용어·별칭을 한 번 공유합니다. 기존 80ms 구간도 전송을 버리는 대신 이 경로로 처리합니다.
- 대기 중의 `insertLineBreak`와 `insertParagraph`만 beforeinput에서 취소하며 `insertCompositionText`나 `insertText`는 취소하지 않습니다. 브라우저에 따라 beforeinput이 취소 불가능할 수 있으므로 실제 OS 확인은 남아 있습니다.
- 조합 본문을 DOM으로 재작성하거나 `event.data`를 덧붙이지 않습니다. 최종 textarea 값 또는 ProseMirror의 실제 문서 상태를 읽습니다.
- 추가 키 입력·붙여넣기·목록 선택·새 조합·포커스 이탈·입력창 제거·종료 시 대기 요청을 취소합니다.
- Shift+Enter는 기존 줄바꿈이며, 부분 일치나 미등록 용어는 자동으로 추천 항목을 전송하지 않고 개인 알림과 원래 입력을 유지합니다.

## 검증

새 textarea/IME 회귀 검사 6개 중 4개는 수정 전 실패했고 수정 후 통과했습니다. 실제 ProseMirror 라이브러리의 문서 상태를 이용한 조합 Enter 검사 1개도 추가했습니다. 전체 자동 검사는 57개입니다.

검사는 jsdom의 합성 CompositionEvent/KeyboardEvent/InputEvent와 실제 ProseMirror 라이브러리, Foundry API 계약 모형에서 수행했습니다. 실제 Foundry 서버 및 Windows/macOS IME에서의 검증 결과와는 구분합니다.

## 참고

- https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event
- https://developer.mozilla.org/en-US/docs/Web/API/Element/compositionend_event
- https://developer.mozilla.org/en-US/docs/Web/API/Element/beforeinput_event
