import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { JsonFileStore, Ledger, LedgerStore, Receipt, blockAnchorKey, verifyReceipt } from "../lib/ledger";
import { PostgresStore, applyMigrations } from "../lib/ledger-postgres";
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
  npm run ledger -- migrate [--supabase]                             DB 스키마 적용 (DATABASE_URL 필요)

저장소: .env DATABASE_URL이 있으면 Postgres(Supabase), 없으면 JSON 파일
        (--ledger 또는 .env LEDGER_FILE, 기본 ./ledger-data/ledger.json)
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
      supabase: { type: "boolean", default: false },
    },
  });

  const [command] = positionals;
  const databaseUrl = process.env.DATABASE_URL;
  const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2 }) : null;
  const store: LedgerStore = pool
    ? new PostgresStore(pool)
    : new JsonFileStore(values.ledger || process.env.LEDGER_FILE || "ledger-data/ledger.json");
  const ledger = new Ledger(store);

  try {
    return await run(command, values, ledger, pool);
  } finally {
    await pool?.end();
  }
}

async function run(
  command: string | undefined,
  values: Record<string, string | boolean | undefined>,
  ledger: Ledger,
  pool: Pool | null,
): Promise<number> {
  const id = values.id as string | undefined;
  const file = values.file as string | undefined;
  const network = values.network as string;

  switch (command) {
    case "migrate": {
      if (!pool) throw new Error("migrate에는 .env의 DATABASE_URL이 필요합니다.");
      await applyMigrations((sql) => pool.query(sql), values.supabase === true);
      console.log(`스키마 적용 완료${values.supabase ? " (Supabase 권한 포함)" : ""}`);
      return 0;
    }

    case "submit": {
      if (!id || !file) break;
      print(await ledger.submit(id, hashReportFile(file)));
      return 0;
    }

    case "seal": {
      const { entries, ...block } = await ledger.seal();
      print({ ...block, reportIds: entries.map((e) => e.reportId) });
      return 0;
    }

    case "anchor": {
      const blocks = await ledger.unanchoredBlocks();
      if (blocks.length === 0) {
        console.log("앵커할 블록이 없습니다.");
        return 0;
      }
      const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
      if (!privateKey) throw new Error(".env의 DEPLOYER_PRIVATE_KEY가 필요합니다.");
      const { provider, registry } = connectRegistry({ network, address: registryAddress(values.registry as string), privateKey });
      try {
        for (const block of blocks) {
          const key = blockAnchorKey(block.height);
          // 이전 실행에서 tx는 성공했지만 원장 저장 전에 중단된 경우: 체인 값만 확인하고 표시한다.
          if (await registry.isAnchored(key)) {
            if (!(await registry.verify(key, block.hash))) {
              throw new Error(`블록 #${block.height}: 체인에 다른 해시가 이미 기록되어 있습니다. 원장을 점검하세요.`);
            }
            await ledger.markAnchored(block.height, { network, txHash: "(recovered)", anchoredAt: new Date().toISOString() });
            console.log(`블록 #${block.height}: 이미 체인에 기록됨 → 원장에 반영`);
            continue;
          }
          const tx = await registry.anchor(key, block.hash);
          await tx.wait();
          await ledger.markAnchored(block.height, { network, txHash: tx.hash, anchoredAt: new Date().toISOString() });
          console.log(`블록 #${block.height}: ${block.hash} → tx ${tx.hash}`);
        }
      } finally {
        provider.destroy();
      }
      return 0;
    }

    case "receipt": {
      if (!id) break;
      const receipt = await ledger.receipt(id);
      if (values.out) {
        writeFileSync(values.out as string, JSON.stringify(receipt, null, 2));
        console.log(`영수증 저장: ${values.out}`);
      } else {
        print(receipt);
      }
      return 0;
    }

    case "verify": {
      if (!file || !values.receipt) break;
      const receipt = JSON.parse(readFileSync(values.receipt as string, "utf8")) as Receipt;
      const fileHash = hashReportFile(file);
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

      const { provider, registry } = connectRegistry({ network, address: registryAddress(values.registry as string) });
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
      const result = await ledger.audit();
      print(result);
      return result.ok ? 0 : 1;
    }

    case "status": {
      print(await ledger.status());
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
