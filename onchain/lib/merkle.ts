import { createHash } from "node:crypto";

/** 증명 한 단계: 형제 노드 해시와, 그 형제가 왼쪽/오른쪽 중 어디에 있는지 */
export type MerkleStep = { hash: string; position: "left" | "right" };

// 리프와 내부 노드에 서로 다른 접두 바이트를 붙여 두 번째 원상(second preimage) 공격을 막는다.
const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

export function sha256(...parts: Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

export function hexToBuf(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error(`32바이트 hex 값이 아닙니다: ${hex}`);
  return Buffer.from(clean, "hex");
}

export const toHex = (buf: Uint8Array) => "0x" + Buffer.from(buf).toString("hex");

/** 리포트 키(bytes32)와 리포트 해시를 묶은 리프 해시 */
export function leafHash(reportKey: string, reportHash: string): string {
  return toHex(sha256(LEAF_PREFIX, hexToBuf(reportKey), hexToBuf(reportHash)));
}

function nodeHash(left: Buffer, right: Buffer): Buffer {
  return sha256(NODE_PREFIX, left, right);
}

// 홀수 개일 때 마지막 노드는 복제하지 않고 그대로 위로 올린다.
function nextLevel(level: Buffer[]): Buffer[] {
  const next: Buffer[] = [];
  for (let i = 0; i < level.length; i += 2) {
    next.push(i + 1 < level.length ? nodeHash(level[i], level[i + 1]) : level[i]);
  }
  return next;
}

export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) throw new Error("리프가 없는 Merkle 트리는 만들 수 없습니다.");
  let level = leaves.map(hexToBuf);
  while (level.length > 1) level = nextLevel(level);
  return toHex(level[0]);
}

export function merkleProof(leaves: string[], index: number): MerkleStep[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new RangeError(`leaf index ${index}가 범위를 벗어났습니다 (0..${leaves.length - 1}).`);
  }
  const proof: MerkleStep[] = [];
  let level = leaves.map(hexToBuf);
  let i = index;
  while (level.length > 1) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) {
      proof.push({ hash: toHex(level[sibling]), position: i % 2 === 0 ? "right" : "left" });
    }
    level = nextLevel(level);
    i = Math.floor(i / 2);
  }
  return proof;
}

export function rootFromProof(leaf: string, proof: MerkleStep[]): string {
  let acc = hexToBuf(leaf);
  for (const step of proof) {
    const sibling = hexToBuf(step.hash);
    acc = step.position === "right" ? nodeHash(acc, sibling) : nodeHash(sibling, acc);
  }
  return toHex(acc);
}
