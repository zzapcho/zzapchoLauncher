# zzapcho Launcher

작고 간결한 Minecraft 커스텀 런처 v2의 초기 버전입니다. 420×560 고정 데스크톱 창, JSON 기반 프로필, 프로필별 배경/강조색, 그리고 실제 런처로 교체 가능한 mock launch 흐름을 제공합니다.

## 기술 스택

- Tauri 2
- React 19 + TypeScript
- Vite 7
- 외부 UI 라이브러리 없는 순수 CSS

## 실행

Node.js와 Rust가 설치되어 있어야 합니다.

```powershell
npm install
npm run dev
```

Tauri 데스크톱 창은 다음 명령으로 실행합니다.

```powershell
npm run tauri:dev
```

웹 빌드는 `npm run build`, 데스크톱 번들은 `npm run tauri:build`를 사용합니다.

## 프로필 시스템

프로필은 `src/data/profiles.json`에서 관리합니다. `id`, 표시 문구, 배경 이미지, accent 색상, Minecraft/로더 버전, 서버, 콘텐츠, 사용자 수정 가능 필드, 메모리와 JVM 옵션을 한 객체에 담습니다. 선택한 프로필 ID는 `zzapchoLauncher.selectedProfileId` 키로 localStorage에 저장됩니다.

원격 manifest를 연결하려면 `src/services/profileService.ts`의 `PROFILE_MANIFEST_URL`에 URL을 지정하세요. 원격 요청이나 검증이 실패하면 로컬 JSON으로 안전하게 돌아옵니다. 관리자가 관리하는 값은 manifest가 소유하고, 향후 사용자 override는 `editableFields`가 `true`인 항목에만 허용하는 구조입니다.

## 아직 mock인 기능

Play는 현재 프로필/콘텐츠 확인 상태를 순서대로 보여주고 선택한 프로필을 콘솔에 출력합니다. Microsoft 계정 인증, Java 탐색, Minecraft/로더/모드/리소스팩/셰이더 설치, 서버 자동 등록, 실제 프로세스 실행은 아직 연결되지 않았습니다.

## 백업

수동 백업:

```powershell
npm run backup
# 또는 이름 지정
powershell -ExecutionPolicy Bypass -File scripts/backup.ps1 -BackupName before-feature
```

파일은 `Backups/yyyy-MM-dd_HH-mm-ss_백업이름.zip` 형식으로 생성됩니다. `.git`, `node_modules`, `dist`, Rust `target`, 기존 `Backups`는 제외됩니다.

6시간마다 자동 백업하는 Windows 작업 스케줄러 등록:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1 -IntervalHours 6 -BackupName auto
```

해제는 `scripts/uninstall-backup-task.ps1`을 실행합니다.

## 로드맵

1. 실제 Minecraft launch 연결
2. Microsoft 계정 인증
3. 게임/로더/콘텐츠 다운로드와 동기화
4. 기본 서버 자동 등록
5. 별도 관리자 웹 콘솔
6. GitHub 원격 manifest 자동 업데이트
7. 런처 자동 업데이트
8. 테마와 프로필 사용자 설정
