# zzapcho Launcher

Tauri 2, React 19, TypeScript로 만든 Minecraft 커스텀 런처입니다.

## 개발 실행

```powershell
npm install
npm run tauri:dev
```

일반 빌드:

```powershell
npm run tauri:build
```

## GitHub Release BAT

배포 파일 경로:

```text
scripts\release.bat
```

탐색기에서 `scripts` 폴더를 열고 `release.bat`을 더블클릭하면 됩니다. 실행 후 버전을 입력할 수 있으며, 아무것도 입력하지 않고 Enter를 누르면 현재 버전의 패치 번호가 자동으로 1 증가합니다.

터미널에서도 실행할 수 있습니다.

```powershell
# 버전 자동 증가
.\scripts\release.bat

# 버전 직접 지정
.\scripts\release.bat 0.4.0

# 실제 배포 없이 환경만 검사
.\scripts\release.bat -ValidateOnly
```

BAT는 GitHub 동기화, 버전 변경, 의존성 및 빌드 검사, 백업, MSI/NSIS 생성, updater 서명, Git 커밋·푸시, GitHub Release 업로드, `latest.json` 검증을 순서대로 처리합니다.

## Microsoft 로그인

로그인 버튼을 누르면 기본 브라우저에서 Microsoft 기기 로그인이 열립니다. 표시되는 코드는 자동으로 클립보드에 복사됩니다. 로그인 세션은 Windows 자격 증명 저장소와 앱 데이터 세션에 저장되며 다음 실행부터 자동으로 복구됩니다.

## Java 설정

설정 화면에서 프로필별 Java 실행 파일 경로를 직접 입력할 수 있습니다. `설치된 Java 찾기`를 누르면 시스템의 Java를 검색하고, 프로필에 필요한 Java 버전만 선택 목록에 표시합니다. 호환 버전이 없으면 Eclipse Temurin을 자동으로 다운로드하고 선택할 수 있습니다.

Java 요구 버전은 프로필의 `javaVersion`을 우선 사용하며 Java 8/17/21/25/26을 지원합니다. 값이 없으면 Minecraft 버전에 맞춰 자동 결정하며 Minecraft 26.x는 공식 요구 버전인 Java 25를 사용합니다.

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
