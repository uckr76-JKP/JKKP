import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { JsonFileStore, Ledger, Receipt, blockAnchorKey, verifyReceipt } from "../lib/ledger";
import { hashReportFile } from "../lib/proof";
import { connectRegistry } from "../lib/registry";

const USAGE = `사용법:
  npm run ledger -- submit  --id VR-2026-10-0001 --file report.pdf   대기열에 추가
  npm run ledger -- seal                                             대기열을 블록으로 확정
  npm run ledger -- anchor  [--network amoy] [--registry 0x...]      미앵커 블록을 공개 체인에 기록
  npm run ledger -- receipt --id VR-2026-10-0001 [--out r.json]      검증 영수증 발급
  npm run ledger -- verify  --file report.pdf --receipt r.json [--offline] [--network amoy]
  npm run ledger -- audit                                            원장 전체 점검
  npm run ledger -- status

원장 파일: --ledger 또는 .env LEDGER_FILE (기본 ./ledger-data/ledger.json)
종료 코드(verify): 0 VALID · 1 INVALID · 2 NOT_ANCHORED · 3 오류`;

function registryAddress(override?: string): string {
  const address = override || process.env.REGISTRY_ADDRESS;
  if (!address) throw new Error("--registry 또는 .env의 REGISTRY_ADDRESS가 필요합니다.");
  return address;
}

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      id: { type: "string" },
      file: { type: "string" },
      receipt: { type: "string" },
      out: { type: "string" },
      ledger: { type: "string" },
      network: { type: "string", default: "amoy" },
      registry: { type: "string" },
      offline: { type: "boolean", default: false },
    },
  });

  const [command] = positionals;
  const ledger = new Ledger(new JsonFileStore(values.ledger || process.env.LEDGER_FILE || "ledger-data/ledger.json"));

  switch (command) {
    case "submit": {
      if (!values.id || !values.file) break;
      print(ledger.submit(values.id, hashReportFile(values.file)));
      return 0;
    }

    case "seal": {
      const { entries, ...block } = ledger.seal();
      print({ ...block, reportIds: entries.map((e) => e.reportId) });
      return 0;
    }

    case "anchor": {
      const blocks = ledger.unanchoredBlocks();
      if (blocks.length === 0) {
        console.log("앵커할 블록이 없습니다.");
        return 0;
      }
      const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
      if (!privateKey) throw new Error(".env의 DEPLOYER_PRIVATE_KEY가 필요합니다.");
      const { provider, registry } = connectRegistry({ network: values.network!, address: registryAddress(values.registry), privateKey });
      try {
        for (const block of blocks) {
          const key = blockAnchorKey(block.height);
          // 이전 실행에서 tx는 성공했지만 원장 저장 전에 중단된 경우: 체인 값만 확인하고 표시한다.
          if (await registry.isAnchored(key)) {
            if (!(await registry.verify(key, block.hash))) {
              throw new Error(`블록 #${block.height}: 체인에 다른 해시가 이미 기록되어 있습니다. 원장을 점검하세요.`);
            }
            ledger.markAnchored(block.height, { network: values.network!, txHash: "(recovered)", anchoredAt: new Date().toISOString() });
            console.log(`블록 #${block.height}: 이미 체인에 기록됨 → 원장에 반영`);
            continue;
          }
          const tx = await registry.anchor(key, block.hash);
          await tx.wait();
          ledger.markAnchored(block.height, { network: values.network!, txHash: tx.hash, anchoredAt: new Date().toISOString() });
          console.log(`블록 #${block.height}: ${block.hash} → tx ${tx.hash}`);
        }
      } finally {
        provider.destroy();
      }
      return 0;
    }

    case "receipt": {
      if (!values.id) break;
      const receipt = ledger.receipt(values.id);
      if (values.out) {
        writeFileSync(values.out, JSON.stringify(receipt, null, 2));
        console.log(`영수증 저장: ${values.out}`);
      } else {
        print(receipt);
      }
      return 0;
    }

    case "verify": {
      if (!values.file || !values.receipt) break;
      const receipt = JSON.parse(readFileSync(values.receipt, "utf8")) as Receipt;
      const fileHash = hashReportFile(values.file);
      const base = { reportId: receipt.reportId, fileHash, blockHeight: receipt.block.height, blockHash: receipt.block.hash };

      const offline = verifyReceipt(receipt, fileHash);
      if (!offline.ok) {
        print({ ...base, status: "INVALID", reason: offline.reason });
        return 1;
      }
      if (values.offline) {
        print({ ...base, status: "VALID_OFFLINE" });
        return 0;
      }

      const { provider, registry } = connectRegistry({ network: values.network!, address: registryAddress(values.registry) });
      try {
        const key = blockAnchorKey(receipt.block.height);
        if (!(await registry.isAnchored(key))) {
          print({ ...base, status: "NOT_ANCHORED" });
          return 2;
        }
        const anchored = await registry.verify(key, receipt.block.hash);
        print({ ...base, status: anchored ? "VALID" : "INVALID", ...(!anchored && { reason: "ANCHOR_MISMATCH" }) });
        return anchored ? 0 : 1;
      } finally {
        provider.destroy();
      }
    }

    case "audit": {
      const result = ledger.audit();
      print(result);
      return result.ok ? 0 : 1;
    }

    case "status": {
      const state = ledger.state();
      print({
        blocks: state.blocks.length,
        pending: state.pending.length,
        unanchored: state.blocks.filter((b) => !b.anchor).map((b) => b.height),
        head: state.blocks.at(-1)?.hash ?? null,
      });
      return 0;
    }
  }

  console.error(USAGE);
  return 3;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 3;
  });
