# zzapcho Launcher

Tauri 2, React 19, TypeScript로 만든 Minecraft 커스텀 런처입니다.

## 실행과 빌드

```powershell
npm install
npm run tauri:dev
npm run tauri:build
```

## Microsoft 로그인

로그인 버튼을 누르면 기본 브라우저에 Microsoft 기기 로그인 화면이 열립니다. 런처에 표시된 코드를 입력하면 Xbox Live와 Minecraft Services 인증을 완료합니다. 별도의 Client ID 입력은 필요하지 않습니다. 계정 표시 정보는 로컬 저장소에, 갱신 토큰은 Windows 자격 증명 관리자에 저장되며 다음 실행부터 자동으로 세션을 복원합니다.

## Minecraft 실행과 Java

PLAY를 누르면 프로필의 Minecraft 및 Fabric/Quilt/Forge 파일을 확인·설치한 뒤 실제 Java 프로세스를 실행합니다. 게임의 stdout/stderr는 런처의 게임 로그 탭에 실시간으로 표시됩니다.

Java 런타임 관리는 `src-tauri/src/java_runtime.rs`로 분리되어 있습니다. 프로필의 `javaVersion` 값이 있으면 해당 버전을 사용하고, 없으면 Minecraft 버전에 맞춰 Java 8/17/21을 선택합니다. 설치된 런타임이 없으면 Eclipse Temurin JRE를 앱 데이터 폴더에 자동 설치합니다. 향후 콘솔에서도 `ensure_java_runtime` 명령과 같은 모듈을 재사용할 수 있습니다.

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
