# 03. 데이터 저장소 및 Envelope Encryption 보안 설계

## 1. 보안 설계 원칙

데스크톱 터미널 매니저는 수십~수백 개의 SSH 비밀번호와 개인키 패스프레이즈를 저장합니다. 각 항목마다 OS 키체인(`keyring`)을 직접 호출하면 OS에 따라 반복적인 권한 승인 팝업이 뜨거나 키체인 크기 제한에 걸릴 수 있습니다.

Conduit은 이를 해결하기 위해 **Envelope Encryption(봉투 암호화)** 아키텍처를 채택합니다.

1. **Master Key (KEK)**: OS 기본 키체인(Windows Credential Manager / macOS Keychain / Linux Secret Service)에 **256-bit 마스터 키 단 1개**만 저장합니다.
2. **Data Encryption**: 모든 비밀번호·패스프레이즈는 고유한 96-bit 랜덤 Nonce와 함께 `AES-256-GCM`으로 암호화한 뒤 SQLite `secrets` 테이블에 저장합니다.
3. **Memory Hygiene**: 복호화된 평문 버퍼와 마스터 키는 `zeroize::Zeroize`를 통해 스코프 종료 시 메모리에서 즉시 덮어씁니다.
4. **Headless / Sandbox Fallback**: Docker 컨테이너나 CI 환경처럼 OS 데몬 키체인이 없는 환경에서 웹 서버 모드로 실행할 경우, 로컬 키 파일(`.conduit-master.key`, Unix `0600` 권한)로 안전하게 폴백합니다.

---

## 2. SQLite 스키마 (`conduit-storage`)

```sql
-- 1. 계층형 폴더 트리
CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    parent_id TEXT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

-- 2. 멀티 프로토콜 세션 북마크
CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    folder_id TEXT NULL,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL,          -- local_pty | ssh | serial | telnet
    host TEXT NULL,
    port INTEGER NULL,
    username TEXT NULL,
    shell TEXT NULL,
    cwd TEXT NULL,
    serial_port TEXT NULL,
    baud_rate INTEGER NULL,
    auth_type TEXT NULL,
    key_path TEXT NULL,
    credential_id TEXT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    port_forwards_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);

-- 3. AES-256-GCM 암호화된 자격 증명
CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY,
    ciphertext_b64 TEXT NOT NULL,    -- base64(12B nonce || AES-GCM ciphertext + tag)
    updated_at INTEGER NOT NULL
);

-- 4. SSH Host Key 검증 (TOFU: Trust On First Use)
CREATE TABLE IF NOT EXISTS known_hosts (
    host_port TEXT PRIMARY KEY,
    algorithm TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL
);

-- 5. 사용자 커스터마이징 설정
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
);
```

---

## 3. SSH 서버 호스트 키 검증 (TOFU)

`StorageRepository::verify_or_store_host_key(host_port, algorithm, fingerprint)`는 다음 3가지 상태를 반환합니다.

- `Trusted`: 기존에 등록된 `known_hosts` 지문과 일치함.
- `NewlyAdded`: 최초 접속으로 지문을 저장하고 신뢰함(TOFU).
- `Mismatch { expected, actual }`: 기존 지문과 불일치 — 중간자 공격(MITM) 위험 경고 후 연결을 차단할 수 있습니다.

---

## 4. 웹 서버 기본 접근 제어 정책 (`conduit-web`)

- `conduit-web`은 개인 로컬 서버나 PC에 띄워 사용하는 것을 기본 시나리오로 가정하므로 **기본값으로 접근 제어가 비활성화(`access_control: false`)** 되어 있습니다.
- 추후 멀티 유저·외부 노출 환경을 위한 인증/접근 제어 기능이 추가될 예정입니다.
