# 정산 검증 리포트 온체인 기록 (Verifica On-chain Proof)

확정된 정산 검증 리포트 파일의 **SHA-256 해시값만** EVM 블록체인에 기록하고,
정산 당사자가 받은 리포트 파일을 기록과 대조해 변경 여부를 확인합니다.
매출·계약 등 원본 데이터는 체인에 올라가지 않습니다.

기본 네트워크는 **Polygon Amoy 테스트넷**입니다. 다른 EVM 체인은 `hardhat.config.ts`와
`lib/registry.ts`의 `NETWORKS`에 RPC를 추가하면 됩니다.

## 구성
| 파일 | 역할 |
|---|---|
| `contracts/SettlementProofRegistry.sol` | 해시 기록 컨트랙트. 같은 리포트 ID는 덮어쓸 수 없음. owner가 기록 권한(recorder) 관리 |
| `lib/proof.ts` | 파일 → SHA-256, 리포트 ID → bytes32 키 변환 |
| `lib/registry.ts` | 컨트랙트 연결·대조 로직 (서버/Supabase 함수에서 재사용 가능) |
| `cli/proof.ts` | 기록·대조 CLI |
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
