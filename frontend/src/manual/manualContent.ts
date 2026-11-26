export interface ManualSection {
  id: string;
  title: string;
  badge: string;
  summary: string;
  blocks: Array<{
    heading: string;
    body: string[];
    tips?: string[];
  }>;
}

export const USER_MANUAL_SECTIONS: ManualSection[] = [
  {
    id: 'getting-started',
    title: '1. 시작하기 (Conduit Desktop)',
    badge: '개요',
    summary:
      'Conduit은 Rust 코어 엔진과 Tauri v2 기반으로 동작하는 크로스 플랫폼 멀티 프로토콜 데스크톱 터미널입니다.',
    blocks: [
      {
        heading: '네이티브 데스크톱 아키텍처',
        body: [
          'Tauri v2 Binary IPC Channel을 통해 OS와 직접 통신하며, 자격 증명 마스터 키는 OS 키체인에 안전하게 보관됩니다.',
          '상단 네이티브 메뉴의 [보기] / [도움말 → 사용자 매뉴얼] 또는 F1 키로 언제든 이 매뉴얼을 열 수 있습니다.',
        ],
        tips: [
          'Windows, macOS, Linux에서 동일한 UI와 단축키로 로컬 쉘·SSH·SFTP·Serial·Telnet 세션을 통합 관리할 수 있습니다.',
        ],
      },
    ],
  },
  {
    id: 'protocols',
    title: '2. 멀티 프로토콜 & 간편 SSH 연결',
    badge: '프로토콜',
    summary: '상단 간편 SSH 입력창과 [새 연결] 창으로 모든 프로토콜에 빠르게 접속합니다.',
    blocks: [
      {
        heading: '간편 SSH 연결 (user@host)',
        body: [
          'Ctrl+Shift+E를 누르거나 상단의 [새 연결] 버튼을 누르면 간편 SSH 연결 창이 열립니다.',
          '`test@192.128.0.1` 또는 `test@192.128.0.1:2222`를 입력한 뒤 다음 단계에서 비밀번호(`Password for user@host`)를 입력하면 북마크에 저장하지 않고 즉시 연결됩니다(`Remember` 체크 시 현재 세션 동안 기억).',
          '연결 후 터미널 헤더의 북마크 저장 버튼(Ctrl+Shift+D)을 누르면 호스트명(hostname), IP, 포트, 사용자명이 자동 채워진 상태로 북마크에 저장할 수 있습니다(비밀번호만 다시 입력).',
          '새로운 북마크 생성은 좌/우 사이드바의 [세션 북마크] 패널 내 [새 북마크 / 연결(+)] 또는 우클릭 메뉴를 통해서만 진행할 수 있습니다.',
        ],
        tips: ['모달 창은 텍스트 드래그 중 마우스가 창 밖으로 나가도 닫히지 않습니다. X, 취소 버튼 또는 Esc로 닫을 수 있습니다.'],
      },
      {
        heading: '지원 프로토콜',
        body: [
          'Local PTY: Windows(PowerShell/CMD), macOS(Zsh), Linux(Bash) 기본 쉘 또는 사용자 지정 쉘/작업 폴더로 로컬 터미널을 엽니다.',
          'SSH: 비밀번호 인증 및 개인키(Passphrase 포함) 인증을 지원하며, Keepalive 패킷으로 유휴 끊김을 방지합니다.',
          'Serial: 연결된 COM / ttyUSB 포트를 자동 열거하고 Baud Rate(예: 115200)를 지정해 장비 콘솔에 접속합니다.',
          'Telnet: RFC 854 IAC 협상과 NAWS(창 크기 동기화)를 지원하는 원격 Telnet 세션에 연결합니다.',
        ],
      },
    ],
  },
  {
    id: 'tabs-splits-broadcast',
    title: '3. 드래그 화면 분할 & 하단 Broadcast',
    badge: '워크스페이스',
    summary: '창/탭 드래그로 최대 2×2 화면 분할을 구성하고, 하단 Broadcast 입력창으로 명령을 전송합니다.',
    blocks: [
      {
        heading: '드래그 자동 분할 (최대 2×2)',
        body: [
          '상단 탭이나 각 터미널 패인의 헤더를 드래그하여 다른 터미널 창의 좌/우/상/하 가장자리에 놓으면 자동으로 수평/수직 분할됩니다. 중앙에 놓으면 두 창의 위치가 교환됩니다.',
          '사이드바의 북마크를 터미널 창으로 드래그해 바로 분할 연결할 수도 있으며, 분할된 패인 헤더를 상단 탭 바에 드롭하면 독립 탭으로 분리됩니다.',
        ],
        tips: ['가독성을 위해 한 탭에는 최대 2×2(4개)까지 분할됩니다.'],
      },
      {
        heading: '하단 Broadcast 입력 창 (3가지 모드)',
        body: [
          '하단 Activity Bar의 Broadcast 아이콘(Ctrl+Shift+M)을 누르면 명령어 입력창이 열립니다.',
          '1) 전체 세션 Broadcast: 열려 있는 모든 탭의 연결된 세션에 전송',
          '2) 현재 화면 세션만 Broadcast: 현재 활성 탭에 보이는 분할 창들에만 전송',
          '3) 선택된 세션만 실행: 현재 포커스된(선택된) 단일 세션에만 명령어 전송',
        ],
      },
    ],
  },
  {
    id: 'bookmarks-vault',
    title: '4. Activity Bar · 패널 이동 · 중첩 폴더 북마크',
    badge: '레이아웃/보안',
    summary: 'VS Code 스타일 아이콘 바, 좌/우/하단 패널 토글 및 드래그 이동, 다단계 폴더 트리를 지원합니다.',
    blocks: [
      {
        heading: 'VS Code 스타일 Activity Bar & 레이아웃 토글',
        body: [
          '우측 상단의 레이아웃 토글 버튼으로 좌측 사이드바(Ctrl+B), 하단 패널(Ctrl+J), 우측 사이드바(Ctrl+Alt+B)를 빠르게 켜고 끌 수 있습니다.',
          '좌/우/하단 바에는 아이콘만 표시되며 마우스를 올리면 기능명과 단축키가 안내됩니다.',
          '아이콘(예: 세션 북마크)을 드래그해 오른쪽이나 하단 바에 놓으면 해당 패널이 그 위치로 이동합니다.',
        ],
      },
      {
        heading: '하위 폴더 트리 · 드래그 이동 · 가져오기/내보내기',
        body: [
          '폴더 위에 마우스 우클릭을 하면 해당 폴더 안에 하위 폴더 추가 또는 세션 추가를 할 수 있으며, 빈 공간에 우클릭하면 루트에 추가할 수 있습니다.',
          '폴더나 세션을 드래그해 다른 폴더로 이동(폴더 이동 시 내부 항목 전체 이동)하거나 같은 폴더 내 순서를 변경할 수 있습니다.',
          '북마크·폴더 삭제 시 확인 창이 표시되며, 상단 내보내기/가져오기 버튼으로 JSON 백업(비밀번호 포함 선택, 병합/덮어쓰기)을 지원합니다.',
        ],
      },
      {
        heading: 'Envelope Encryption 보안',
        body: [
          'OS 기본 키체인에는 256-bit 마스터 키 단 1개만 보관되고, 비밀번호·패스프레이즈는 AES-256-GCM으로 암호화되어 SQLite에 저장됩니다.',
        ],
      },
    ],
  },
  {
    id: 'sftp-explorer',
    title: '5. SFTP 파일 탐색기',
    badge: '파일 전송',
    summary: 'SSH 접속 중 재인증 없이 SFTP 탐색기를 열어 파일을 주고받을 수 있습니다.',
    blocks: [
      {
        heading: '드래그 앤 드롭 파일 전송',
        body: [
          'SSH 패인이 포커스된 상태에서 하단 Activity Bar의 [SFTP 탐색기] 아이콘(Ctrl+Shift+S)을 누릅니다.',
          '로컬 PC의 파일을 탐색기 영역에 드래그 앤 드롭하면 현재 원격 경로에 즉시 업로드됩니다.',
        ],
      },
    ],
  },
  {
    id: 'customization',
    title: '6. 테마 · 폰트 · 종료 확인 설정',
    badge: '커스터마이징',
    summary: '컬러 스킴, Nerd Fonts, 폰트 합자(Ligatures), 세션 종료 시 확인 여부를 설정합니다.',
    blocks: [
      {
        heading: '실시간 테마 & 세션 종료 확인',
        body: [
          '설정(Ctrl+,) 창에서 Catppuccin Mocha, Tokyo Night, Dracula, One Dark Pro, Solarized Light 중 원하는 테마를 즉시 적용할 수 있습니다.',
          '[세션 종료 시 동작]에서 "종료 전 한 번 물어보기"(기본값) 또는 "바로 닫기"를 선택할 수 있습니다.',
        ],
      },
    ],
  },
  {
    id: 'shortcuts-reference',
    title: '7. 단축키 & 성능 팁',
    badge: '레퍼런스',
    summary: '자주 쓰는 단축키와 대용량 로그 출력 시 성능 유지 원리를 확인하세요.',
    blocks: [
      {
        heading: '기본 단축키 일람',
        body: [
          'F1 : 사용자 매뉴얼 열기',
          'Ctrl+Tab / Ctrl+Shift+Tab : 다음 / 이전 세션 탭 순환 이동',
          'Ctrl+B / Ctrl+J / Ctrl+Alt+B : 좌측 / 하단 / 우측 패널 토글',
          'Ctrl+Shift+B : 세션 북마크 뷰 토글',
          'Ctrl+Shift+M : Broadcast 입력 뷰 토글',
          'Ctrl+Shift+S : SFTP 탐색기 뷰 토글',
          'Ctrl+Shift+T : 새 로컬 터미널 탭',
          'Ctrl+Shift+E : 간편 SSH 연결 (user@host)',
          'Ctrl+Shift+D : 현재 세션을 북마크에 저장',
          'Ctrl+Shift+F : 터미널 내 검색 바 열기',
          'Ctrl+, : 환경 설정 열기',
        ],
        tips: [
          '대량 로그가 출력될 때 Conduit은 Adaptive Coalescer(4ms/64KB)와 Watermark 백프레셔(512KB)를 작동시키며, 입력 채널이 분리되어 있어 Ctrl+C가 항상 즉시 동작합니다.',
        ],
      },
    ],
  },
];
