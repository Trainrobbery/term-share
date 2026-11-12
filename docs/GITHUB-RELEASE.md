# GitHub 공개 배포 준비

저장소: https://github.com/Trainrobbery/term-share

이 문서는 설정된 설치 주소를 활성화하는 공개 배포 절차입니다. 소스 업로드에 이어 manifest와 릴리스 ZIP을 로그인 없이 받을 수 있도록 게시하면 Foundry의 URL 설치·업데이트를 사용할 수 있습니다.

## 주소와 파일명

| 항목 | 값 |
|---|---|
| 기본 브랜치 | `main` |
| module.json의 version | `0.1.0-alpha.13` |
| 릴리스 태그 | `v0.1.0-alpha.13` |
| ZIP 첨부 파일명 | `Term-Share-0.1.0-alpha.13-V13.zip` |
| 별도 manifest 첨부 파일명 | `module.json` |
| 설치·업데이트용 manifest | `https://raw.githubusercontent.com/Trainrobbery/term-share/main/module.json` |
| ZIP 다운로드 | `https://github.com/Trainrobbery/term-share/releases/download/v0.1.0-alpha.13/Term-Share-0.1.0-alpha.13-V13.zip` |

## 1. 다운로드 주소 공개

Foundry의 기본 URL 설치·업데이트는 로그인 없이 받을 수 있는 manifest와 ZIP 주소가 필요합니다. 이 저장소에서 배포하려면 GitHub의 **Settings → General → Danger Zone → Change repository visibility**에서 **Public**으로 변경합니다. Public은 소스와 파일을 누구나 볼 수 있는 설정입니다. 저장소를 비공개로 유지할 경우에는 별도의 공개 배포 위치가 필요합니다.

## 2. 소스 업로드

1. 배포 ZIP을 풉니다.
2. ZIP 안 `term-share` 폴더의 **내용물**을 저장소의 기본 브랜치 `main`에 업로드하고 커밋합니다.
3. 저장소 최상위에 `module.json`, `scripts/`, `styles/`, `templates/`, `lang/` 등이 보이는지 확인합니다. `term-share/module.json`처럼 한 단계 더 들어가면 위 manifest 주소가 맞지 않습니다.

개발 의존성 `node_modules`는 배포 ZIP에 포함하지 않았습니다. 현재 배포 ZIP에는 모듈 소스와 문서·예시·자동 검사가 들어 있습니다.

## 3. 릴리스 게시

1. 저장소의 **Releases → Draft a new release**를 엽니다.
2. 태그를 **`v0.1.0-alpha.13`**, 대상 브랜치를 **`main`**으로 지정합니다.
3. 첨부 파일에 **`Term-Share-0.1.0-alpha.13-V13.zip`**과 별도로 제공한 **`module.json`**을 추가합니다.
4. 알파 배포이므로 **This is a pre-release**를 선택할 수 있습니다. 이번 manifest는 main의 Raw 주소여서 GitHub의 latest 릴리스 선택에 의존하지 않습니다.
5. **Publish release**를 누릅니다. 태그와 파일명을 바꾸려면 `module.json`의 download 주소도 함께 바꿔야 합니다.

## 4. Foundry 설치

게시 후 로그인하지 않은 창에서 manifest의 JSON과 ZIP이 열리고 다운로드되는지 확인합니다. 이어서 Foundry 설정 화면의 **애드온 모듈 → 모듈 설치 → Manifest URL**에 다음 주소를 입력합니다.

```text
https://raw.githubusercontent.com/Trainrobbery/term-share/main/module.json
```

수동으로 설치한 기존 알파는 새 패키지로 한 번 교체하거나 해당 manifest로 설치해 배포 주소를 적용할 수 있습니다. 사전은 월드 설정에 저장되며 모듈 ID `term-share`와 사전 형식 버전 `1`을 유지합니다.

## 다음 버전

다음 배포에서는 모듈 버전을 올리고 새 릴리스 태그·ZIP 파일명에 맞춰 download를 갱신합니다. 새 ZIP을 게시한 뒤 main의 module.json을 최신 버전으로 갱신하면 같은 고정 manifest 주소로 업데이트를 확인할 수 있습니다. ZIP 안과 저장소의 module.json은 같은 버전과 다운로드 주소를 담아야 합니다.

## 참고

- https://foundryvtt.com/article/module-development/
- https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
