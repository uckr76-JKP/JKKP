import "dotenv/config";
import { parseArgs } from "node:util";
import { hashReportFile, toReportKey } from "../lib/proof";
import { checkProof, connectRegistry } from "../lib/registry";

const USAGE = `사용법:
  npm run proof -- anchor --id VR-2026-10-0001 --file report.pdf [--network amoy] [--registry 0x...]
  npm run proof -- check  --id VR-2026-10-0001 --file report.pdf [--network amoy] [--registry 0x...]
  npm run proof -- hash   --file report.pdf

종료 코드(check): 0 MATCH · 1 MISMATCH · 2 NOT_FOUND · 3 오류`;

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      id: { type: "string" },
      file: { type: "string" },
      network: { type: "string", default: "amoy" },
      registry: { type: "string" },
    },
  });

  const [command] = positionals;
  if (!values.file || !["anchor", "check", "hash"].includes(command)) {
    console.error(USAGE);
    return 3;
  }

  const fileHash = hashReportFile(values.file);
  if (command === "hash") {
    console.log(fileHash);
    return 0;
  }

  if (!values.id) {
    console.error("--id가 필요합니다.\n\n" + USAGE);
    return 3;
  }
  const address = values.registry || process.env.REGISTRY_ADDRESS;
  if (!address) {
    console.error("--registry 또는 .env의 REGISTRY_ADDRESS가 필요합니다.");
    return 3;
  }

  const reportKey = toReportKey(values.id);

  if (command === "check") {
    const { provider, registry } = connectRegistry({ network: values.network!, address });
    try {
      const result = await checkProof(registry, values.id, reportKey, fileHash);
      console.log(JSON.stringify(result, null, 2));
      return result.status === "MATCH" ? 0 : result.status === "MISMATCH" ? 1 : 2;
    } finally {
      provider.destroy();
    }
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error(".env의 DEPLOYER_PRIVATE_KEY가 필요합니다. (localhost는 hardhat node가 출력한 테스트 키 사용)");
    return 3;
  }
  const { provider, registry } = connectRegistry({ network: values.network!, address, privateKey });
  try {
    if (await registry.isAnchored(reportKey)) {
      console.error(`${values.id}는 이미 기록되어 있습니다. 같은 ID는 덮어쓸 수 없습니다.`);
      return 3;
    }
    const tx = await registry.anchor(reportKey, fileHash);
    const receipt = await tx.wait();
    console.log(JSON.stringify({ reportId: values.id, reportHash: fileHash, txHash: tx.hash, blockNumber: receipt?.blockNumber }, null, 2));
    return 0;
  } finally {
    provider.destroy();
  }
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 3;
  });
