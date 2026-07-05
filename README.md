# zzapcho Launcher

Tauri 2, React 19, TypeScript로 만든 Minecraft 커스텀 런처입니다.

## 실행과 빌드

```powershell
npm install
npm run tauri:dev
npm run tauri:build
```

## Microsoft 로그인

로그인 버튼을 누르면 Minecraft 기본 런처처럼 기본 브라우저에 Microsoft 계정 선택 화면이 열리고, 완료되면 런처로 돌아옵니다. `zzapcho-online`과 동일하게 Mojang 공개 클라이언트와 Xbox Live 인증을 사용하며 별도의 Client ID 입력은 필요하지 않습니다. 계정 표시 정보는 로컬 저장소에, 갱신 토큰은 Windows 자격 증명 관리자에 저장됩니다.

현재 계정 인증과 Minecraft Services 프로필 조회까지 연결되어 있습니다. 게임 파일 설치, Java 탐색 및 실제 Minecraft 프로세스 실행은 아직 mock 상태입니다.

## 프로필과 콘텐츠

프로필은 `src/data/profiles.json`에서 관리합니다. 선택한 프로필 ID만 로컬 저장소에 보관하며, 모드·리소스팩·셰이더 목록은 프로필별로 분리됩니다. Modrinth 검색 결과는 스크롤 끝에서 추가로 불러옵니다.

## 백업

수동 백업:

```powershell
npm run backup
powershell -ExecutionPolicy Bypass -File scripts/backup.ps1 -BackupName before-feature
```

백업 파일은 `Backups/yyyy-MM-dd_HH-mm-ss_백업이름.zip` 형식으로 생성됩니다.

6시간마다 자동 백업 작업 등록:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1 -IntervalHours 6 -BackupName auto
```
