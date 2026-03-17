# Remember 통합 시스템

이 프로젝트는 아래 3가지를 하나로 연결합니다.

1. `remember.html` 웹 앱
2. Chrome 확장프로그램(`manifest.json`, `extension/popup.html`)
3. Google Drive(`appDataFolder`에 JSON 저장)

## 실행

### 웹 앱
- 브라우저에서 `remember.html`을 열어 사용합니다.
- Google Drive OAuth 로그인은 `file://` 에서 제한되므로, Drive 연동 시에는 `localhost` 또는 HTTPS 정적 호스팅에서 실행하세요.

### 크롬 확장프로그램
1. Chrome에서 `chrome://extensions` 접속
2. 개발자 모드 활성화
3. `압축해제된 확장 프로그램을 로드` 클릭
4. 이 프로젝트 루트 폴더(`remember`) 선택

## Google Drive 연동 설정

웹/확장 모두 화면의 `OAuth 설정` 섹션에 같은 Client ID를 넣으면 같은 Drive 파일을 공유합니다.

### 1) Google Cloud에서 OAuth Client ID 생성
- 유형: **Web application**
- Scope: `https://www.googleapis.com/auth/drive.appdata`

### 2) Authorized redirect URI 추가
- 웹 앱 예시: `https://your-domain/remember.html?oauth_callback=1`
- 로컬 개발 예시: `http://localhost:5500/remember.html?oauth_callback=1`
- 확장프로그램: `https://<EXTENSION_ID>.chromiumapp.org/`
  - `<EXTENSION_ID>`는 확장 프로그램 로드 후 `chrome://extensions`에서 확인 가능

### 3) 앱/확장에서 Client ID 저장
- `OAuth 설정` > `Google OAuth Client ID` 입력 > `Client ID 저장`
- `Google 연결` 버튼으로 로그인

## 동기화 방식

Drive 파일명: `remember-sync-v2.json`

- `양방향 동기화`: 로컬 + Drive 데이터를 ID/수정시각 기준 병합 후 둘 다 최신으로 맞춤
- `Drive 저장`: 로컬 데이터를 Drive로 업로드
- `Drive 불러오기`: Drive 데이터를 로컬로 덮어쓰기

## 데이터 구조(요약)

- `bookmarks[]`: 실제 북마크
- `tombstones[]`: 삭제 전파용 기록(다른 클라이언트에서 삭제 복원 방지)
- `updatedAt`: 데이터셋 마지막 수정 시각

삭제도 동기화되도록 tombstone 기반 병합을 사용합니다.
