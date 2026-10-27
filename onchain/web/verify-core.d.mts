export const LEDGER_VERSION: string;

export type ReceiptStepResult = boolean | null;
export type ReceiptCheck =
  | { ok: true }
  | { ok: false; reason: "HASH_MISMATCH" | "PROOF_INVALID" | "BLOCK_HASH_INVALID" | "VERSION_UNSUPPORTED" };

export function hexToBytes(hex: string): Uint8Array;
export function toHex(bytes: Uint8Array): string;
export function hashFile(bytes: Uint8Array): Promise<string>;
export function reportKey(reportId: string): string;
export function blockAnchorKey(height: number): string;
export function leafHash(key: string, reportHash: string): Promise<string>;
export function rootFromProof(leaf: string, proof: { hash: string; position: "left" | "right" }[]): Promise<string>;
export function blockHash(header: { height: number; prevHash: string; merkleRoot: string; createdAt: number; entryCount: number }): Promise<string>;
export function parseReceipt(text: string): any;
export function inspectReceipt(receipt: any, fileHash: string): Promise<{
  steps: { version: boolean; hashMatch: ReceiptStepResult; proofValid: ReceiptStepResult; blockHashValid: ReceiptStepResult };
  result: ReceiptCheck;
}>;
export function verifyReceipt(receipt: any, fileHash: string): Promise<ReceiptCheck>;
export function checkAnchor(opts: { rpcUrl: string; registry: string; height: number; hash: string }): Promise<
  | { status: "NOT_ANCHORED" }
  | { status: "MATCH" | "MISMATCH"; onChainHash: string; anchoredAt: string; chainBlockNumber: number }
>;
