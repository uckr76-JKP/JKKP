import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { id } from "ethers";

/** 리포트 파일 바이트 그대로의 SHA-256 해시 (0x 접두사 hex, bytes32) */
export function hashReportFile(filePath: string): string {
  return hashReportBytes(readFileSync(filePath));
}

export function hashReportBytes(bytes: Uint8Array): string {
  return "0x" + createHash("sha256").update(bytes).digest("hex");
}

/** 사람이 읽는 리포트 ID(예: VR-2026-10-0001)를 컨트랙트 키(bytes32)로 변환 */
export function toReportKey(reportId: string): string {
  const trimmed = reportId.trim();
  if (!trimmed) throw new Error("reportId가 비어 있습니다.");
  return id(trimmed);
}
