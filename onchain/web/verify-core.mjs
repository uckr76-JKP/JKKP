// 브라우저용 정산 리포트 검증 로직 (Node 테스트에서도 그대로 실행된다).
// lib/merkle.ts · lib/ledger.ts와 같은 계산을 WebCrypto로 구현한 것이며,
// test/VerifyCore.ts가 두 구현의 결과가 같은지 교차 검증한다.
import { Contract, JsonRpcProvider, id } from "ethers";

export const LEDGER_VERSION = "VB-LEDGER-v1";

const REGISTRY_ABI = [
  "function isAnchored(bytes32 reportId) view returns (bool)",
  "function getProof(bytes32 reportId) view returns (tuple(bytes32 reportHash, uint64 anchoredAt, uint64 blockNumber, address recorder))",
];

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function sha256(...parts) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", concat(parts)));
}

export function hexToBytes(hex) {
  const clean = typeof hex === "string" && hex.startsWith("0x") ? hex.slice(2) : hex;
  if (typeof clean !== "string" || !/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error(`32바이트 hex 값이 아닙니다: ${hex}`);
  return Uint8Array.from(clean.match(/../g), (b) => parseInt(b, 16));
}

export function toHex(bytes) {
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 파일 바이트 그대로의 SHA-256 (lib/proof.ts hashReportBytes와 동일) */
export async function hashFile(bytes) {
  return toHex(await sha256(bytes));
}

export const reportKey = (reportId) => id(reportId.trim());
export const blockAnchorKey = (height) => id(`${LEDGER_VERSION}-BLOCK-${height}`);

export async function leafHash(key, reportHash) {
  return toHex(await sha256(Uint8Array.of(0x00), hexToBytes(key), hexToBytes(reportHash)));
}

export async function rootFromProof(leaf, proof) {
  let acc = hexToBytes(leaf);
  for (const step of proof) {
    const sibling = hexToBytes(step.hash);
    acc = step.position === "right"
      ? await sha256(Uint8Array.of(0x01), acc, sibling)
      : await sha256(Uint8Array.of(0x01), sibling, acc);
  }
  return toHex(acc);
}

export async function blockHash(header) {
  const buf = new Uint8Array(8 + 32 + 32 + 8 + 4);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt(header.height));
  buf.set(hexToBytes(header.prevHash), 8);
  buf.set(hexToBytes(header.merkleRoot), 40);
  view.setBigUint64(72, BigInt(header.createdAt));
  view.setUint32(80, header.entryCount);
  return toHex(await sha256(new TextEncoder().encode(LEDGER_VERSION), buf));
}

/** 영수증 JSON 텍스트를 읽고 필요한 필드가 모두 있는지 확인한다. */
export function parseReceipt(text) {
  let receipt;
  try {
    receipt = JSON.parse(text);
  } catch {
    throw new Error("영수증 파일이 JSON 형식이 아닙니다.");
  }
  const block = receipt?.block;
  const ok = receipt
    && typeof receipt.reportId === "string" && receipt.reportId.trim()
    && typeof receipt.reportHash === "string"
    && Array.isArray(receipt.proof)
    && receipt.proof.every((s) => s && typeof s.hash === "string" && (s.position === "left" || s.position === "right"))
    && block
    && Number.isSafeInteger(block.height) && Number.isSafeInteger(block.createdAt) && Number.isSafeInteger(block.entryCount)
    && ["prevHash", "merkleRoot", "hash"].every((k) => typeof block[k] === "string");
  if (!ok) throw new Error("정산 검증 영수증 형식이 아닙니다. 발급받은 .receipt.json 파일을 올려주세요.");
  return receipt;
}

/**
 * 영수증을 단계별로 점검한다. 앞 단계가 실패하면 뒤 단계는 null(확인 안 함).
 * result는 lib/ledger.ts verifyReceipt와 같은 형태다.
 */
export async function inspectReceipt(receipt, fileHash) {
  const steps = { version: receipt.version === LEDGER_VERSION, hashMatch: null, proofValid: null, blockHashValid: null };
  if (!steps.version) return { steps, result: { ok: false, reason: "VERSION_UNSUPPORTED" } };

  steps.hashMatch = receipt.reportHash.toLowerCase() === fileHash.toLowerCase();
  if (!steps.hashMatch) return { steps, result: { ok: false, reason: "HASH_MISMATCH" } };

  try {
    const root = await rootFromProof(await leafHash(reportKey(receipt.reportId), fileHash), receipt.proof);
    steps.proofValid = root === receipt.block.merkleRoot.toLowerCase();
  } catch {
    steps.proofValid = false;
  }
  if (!steps.proofValid) return { steps, result: { ok: false, reason: "PROOF_INVALID" } };

  try {
    const { hash, ...header } = receipt.block;
    steps.blockHashValid = (await blockHash(header)) === hash.toLowerCase();
  } catch {
    steps.blockHashValid = false;
  }
  if (!steps.blockHashValid) return { steps, result: { ok: false, reason: "BLOCK_HASH_INVALID" } };

  return { steps, result: { ok: true } };
}

export async function verifyReceipt(receipt, fileHash) {
  return (await inspectReceipt(receipt, fileHash)).result;
}

/** 공개 체인 컨트랙트에 기록된 블록 해시와 대조한다. */
export async function checkAnchor({ rpcUrl, registry, height, hash }) {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  try {
    const contract = new Contract(registry, REGISTRY_ABI, provider);
    const key = blockAnchorKey(height);
    if (!(await contract.isAnchored(key))) return { status: "NOT_ANCHORED" };
    const proof = await contract.getProof(key);
    return {
      status: proof.reportHash.toLowerCase() === hash.toLowerCase() ? "MATCH" : "MISMATCH",
      onChainHash: proof.reportHash,
      anchoredAt: new Date(Number(proof.anchoredAt) * 1000).toISOString(),
      chainBlockNumber: Number(proof.blockNumber),
    };
  } finally {
    provider.destroy();
  }
}
