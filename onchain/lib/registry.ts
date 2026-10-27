import { Contract, JsonRpcProvider, Wallet } from "ethers";

/** 기록 대조 결과. 홈페이지·서버·CLI가 같은 형태를 사용한다. */
export type ProofCheck =
  | { status: "NOT_FOUND"; reportId: string; fileHash: string }
  | {
      status: "MATCH" | "MISMATCH";
      reportId: string;
      fileHash: string;
      onChainHash: string;
      anchoredAt: string;
      blockNumber: number;
      recorder: string;
    };

// 컨트랙트 전체 ABI 대신 사용하는 함수만 둔다 (artifacts 없이도 동작).
export const REGISTRY_ABI = [
  "function anchor(bytes32 reportId, bytes32 reportHash)",
  "function isAnchored(bytes32 reportId) view returns (bool)",
  "function getProof(bytes32 reportId) view returns (tuple(bytes32 reportHash, uint64 anchoredAt, uint64 blockNumber, address recorder))",
  "function verify(bytes32 reportId, bytes32 reportHash) view returns (bool)",
];

export const NETWORKS: Record<string, string> = {
  localhost: "http://127.0.0.1:8545",
  amoy: process.env.AMOY_RPC_URL || "https://polygon-amoy-bor-rpc.publicnode.com",
};

export function connectRegistry(opts: { network: string; address: string; privateKey?: string }) {
  const rpc = NETWORKS[opts.network];
  if (!rpc) throw new Error(`알 수 없는 network: ${opts.network} (${Object.keys(NETWORKS).join(", ")})`);
  const provider = new JsonRpcProvider(rpc);
  const runner = opts.privateKey ? new Wallet(opts.privateKey, provider) : provider;
  return { provider, registry: new Contract(opts.address, REGISTRY_ABI, runner) };
}

export async function checkProof(registry: Contract, reportId: string, reportKey: string, fileHash: string): Promise<ProofCheck> {
  const proof = await registry.getProof(reportKey);
  if (proof.anchoredAt === 0n) return { status: "NOT_FOUND", reportId, fileHash };

  return {
    status: proof.reportHash.toLowerCase() === fileHash.toLowerCase() ? "MATCH" : "MISMATCH",
    reportId,
    fileHash,
    onChainHash: proof.reportHash,
    anchoredAt: new Date(Number(proof.anchoredAt) * 1000).toISOString(),
    blockNumber: Number(proof.blockNumber),
    recorder: proof.recorder,
  };
}
