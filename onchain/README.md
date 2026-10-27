# 정산 검증 리포트 온체인 기록 (Verifica On-chain Proof)

확정된 정산 검증 리포트 파일의 **SHA-256 해시값만** EVM 블록체인에 기록하고,
정산 당사자가 받은 리포트 파일을 기록과 대조해 변경 여부를 확인합니다.
매출·계약 등 원본 데이터는 체인에 올라가지 않습니다.

기본 네트워크는 **Polygon Amoy 테스트넷**입니다. 다른 EVM 체인은 `hardhat.config.ts`와
`lib/registry.ts`의 `NETWORKS`에 RPC를 추가하면 됩니다.

## 두 가지 기록 방식
| 방식 | 명령 | 공개 체인 트랜잭션 | 용도 |
|---|---|---|---|
| **경량 원장 (권장)** | `npm run ledger` | 블록당 1건 (예: 하루 1회) | 리포트를 자체 해시체인에 쌓고, 블록 해시만 공개 체인에 앵커 |
| 개별 기록 | `npm run proof` | 리포트당 1건 | 건수가 적거나 리포트 하나를 즉시 확정해야 할 때 |

### 경량 원장 구조
```
리포트 해시 ─ submit ─▶ 대기열 ─ seal ─▶ Block n { prevHash, merkleRoot, createdAt, entryCount } ─ anchor ─▶ 공개 체인
                                          ▲ 이전 블록 해시로 연결 (중간 블록 삭제·수정 시 audit에서 끊김 감지)
```
- **영수증(receipt)**: 리포트별 Merkle 증명 + 블록 헤더. 정산 당사자는 원장 없이 *리포트 파일 + 영수증*만으로 검증하고,
  블록 해시를 공개 체인 기록과 대조합니다.
- 리프 해시 = `SHA-256(0x00 ‖ keccak256(리포트 ID) ‖ 리포트 해시)`, 내부 노드 = `SHA-256(0x01 ‖ 왼쪽 ‖ 오른쪽)`, 홀수 노드는 복제하지 않고 위로 올림.
- 블록 해시 = `SHA-256("VB-LEDGER-v1" ‖ height ‖ prevHash ‖ merkleRoot ‖ createdAt ‖ entryCount)`
- 공개 체인 앵커 키 = `keccak256("VB-LEDGER-v1-BLOCK-<height>")`. 기존 `SettlementProofRegistry` 컨트랙트를 그대로 사용합니다.

```bash
npm run ledger -- submit  --id VR-2026-10-0001 --file ./report.pdf
npm run ledger -- seal                                   # 대기열 → 블록 확정
npm run ledger -- anchor                                 # 미앵커 블록을 공개 체인에 기록
npm run ledger -- receipt --id VR-2026-10-0001 --out VR-2026-10-0001.receipt.json
npm run ledger -- verify  --file ./report.pdf --receipt VR-2026-10-0001.receipt.json
npm run ledger -- audit                                  # 원장 전체 점검
```
`verify` 종료 코드: `0` VALID · `1` INVALID · `2` NOT_ANCHORED(아직 앵커 전) · `3` 오류. `--offline`은 공개 체인 대조를 건너뜁니다.

### 저장소
| 저장소 | 사용 조건 | 용도 |
|---|---|---|
| **Postgres / Supabase** (`lib/ledger-postgres.ts`) | `.env`에 `DATABASE_URL` 있음 | 운영. 여러 서버가 동시에 써도 안전 |
| JSON 파일 | `DATABASE_URL` 없음 (기본 `ledger-data/ledger.json`, git 제외) | 로컬 시험, 단일 프로세스 |

**Supabase 적용**
1. Supabase 대시보드 → Project Settings → Database → Connection string(**Session pooler** 권장)을 `.env`의 `DATABASE_URL`에 넣습니다.
   DB 비밀번호가 들어가므로 서버에만 두고 커밋하지 마세요.
2. `npm run ledger -- migrate --supabase` (또는 SQL Editor에서 `sql/001_ledger.sql` → `sql/002_supabase_grants.sql` 순서로 실행)
3. 이후 `submit/seal/anchor/receipt/audit`는 자동으로 DB를 사용합니다.

**DB가 보장하는 것** (`sql/001_ledger.sql`)
- `ledger_append_block()` 함수가 advisory lock + 트랜잭션으로 블록을 붙입니다. 동시에 seal해도 head 위에 블록은 하나만 붙고,
  진 쪽은 `SealConflictError` → 자동 재시도합니다. 같은 리포트가 두 블록에 들어가지 않습니다.
- 트리거로 **추가 전용**: 기록·블록 삭제, 기록 해시·블록 헤더 수정, 확정된 기록 이동, 앵커 정보 덮어쓰기를 막습니다.
- RLS를 켜고 정책을 두지 않아 브라우저용 anon/authenticated 키로는 원장에 접근할 수 없습니다(서버 직접 연결 전용).
- 해시·Merkle 계산은 DB가 아니라 `lib/ledger.ts` 한 곳에서만 합니다. DB 관리자가 트리거를 끄고 값을 고치는 경우는
  `audit`과 공개 체인 앵커로 잡아냅니다(테스트로 확인).

## 구성
| 파일 | 역할 |
|---|---|
| `contracts/SettlementProofRegistry.sol` | 해시 기록 컨트랙트. 같은 리포트 ID는 덮어쓸 수 없음. owner가 기록 권한(recorder) 관리 |
| `lib/proof.ts` | 파일 → SHA-256, 리포트 ID → bytes32 키 변환 |
| `lib/registry.ts` | 컨트랙트 연결·대조 로직 (서버/Supabase 함수에서 재사용 가능) |
| `lib/merkle.ts` | Merkle 트리·증명 |
| `lib/ledger.ts` | 경량 해시체인 원장 (submit/seal/receipt/audit, 영수증 검증), 메모리·JSON 저장소 |
| `lib/ledger-postgres.ts` | Postgres/Supabase 저장소, 마이그레이션 적용 |
| `sql/` | DB 스키마 (`001` 공통, `002` Supabase 권한) |
| `cli/ledger.ts` | 경량 원장 CLI |
| `cli/proof.ts` | 개별 기록·대조 CLI |
| `scripts/deploy.ts` | 컨트랙트 배포 |
| `test/` | 컨트랙트 테스트 |

## 사용법
```bash
npm install
npm test                       # 컨트랙트 테스트

cp .env.example .env           # DEPLOYER_PRIVATE_KEY 입력 (테스트넷 전용 지갑)
npm run deploy:amoy            # 출력된 주소를 .env REGISTRY_ADDRESS에 입력

npm run proof -- anchor --id VR-2026-10-0001 --file ./report.pdf   # 기록
npm run proof -- check  --id VR-2026-10-0001 --file ./report.pdf   # 대조
npm run proof -- hash   --file ./report.pdf                        # 해시만 계산
```
`check` 종료 코드: `0` MATCH · `1` MISMATCH · `2` NOT_FOUND · `3` 오류

로컬에서 시험할 때는 `npx hardhat node`를 띄우고 `npm run deploy:local`로 배포한 뒤
`--network localhost`를 붙여 실행합니다.

## 운영 시 주의
- 해시는 **파일 바이트 그대로** 계산합니다. PDF를 다시 내보내면 내용이 같아도 해시가 달라지므로,
  당사자에게 보낸 그 파일로 기록해야 합니다.
- 리포트 ID는 체인에 keccak256 값으로만 남습니다. 다만 ID 형식이 단순하면 추측해서 대조해 볼 수 있으니,
  외부에 알려지면 안 되는 정보는 ID에 넣지 마세요.
- 개인키는 `.env`에만 두고 커밋하지 마세요. 운영 전환 시 owner는 멀티시그, recorder는 서버 전용 지갑으로 분리하는 것을 권장합니다.
- Windows + Node 24에서 Hardhat **task**로 RPC를 호출하면 종료 시 libuv assertion 오류가 나서
  CLI를 Hardhat 밖(ethers 단독)으로 분리했습니다.
