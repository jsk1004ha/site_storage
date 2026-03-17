# site_storage

이 폴더는 Remember의 실제 실행 파일이 들어 있는 배포 루트입니다. 웹앱과 크롬 확장프로그램이 같은 정적 리소스를 공유합니다.

전체 프로젝트 설명, 설치 방법, Google Drive 설정, 문제 해결은 상위 문서인 [`../README.md`](../README.md)를 먼저 참고하세요.

## 이 폴더에 들어 있는 것

- `index.html`: 웹앱 진입점
- `app.js`: 웹앱과 확장프로그램 팝업이 함께 사용하는 메인 로직
- `app-style.css`: 공통 스타일시트
- `manifest.json`: 크롬 확장프로그램 매니페스트
- `extension/popup.html`: 확장프로그램 팝업 UI
- `extension/background.js`: 백그라운드 저장, 알람, 컨텍스트 메뉴, Drive 동기화 처리
- `service-worker.js`: 웹앱 오프라인 앱 셸 캐시
- `icons/`: PWA 및 확장프로그램 아이콘

## 실행 기준

- 웹앱: 이 폴더를 정적 서버로 서빙한 뒤 `index.html`을 엽니다.
- 확장프로그램: `chrome://extensions`에서 이 `site_storage` 폴더 자체를 로드합니다.

## 참고

- OAuth와 Drive 동기화는 `file://` 환경에서 정상 동작하지 않습니다.
- 라이선스 전문은 [`LICENSE`](LICENSE)를 확인하세요.
