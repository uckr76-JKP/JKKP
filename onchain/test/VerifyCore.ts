import { expect } from "chai";
import { Ledger, MemoryStore, Receipt, blockAnchorKey, blockHash, headerOf, verifyReceipt } from "../lib/ledger";
import { hashReportBytes } from "../lib/proof";

// 브라우저용 검증 코드(web/verify-core.mjs)가 lib/ 구현과 같은 결과를 내는지 교차 검증한다.
type Core = typeof import("../web/verify-core.mjs");

const bytes = (text: string) => new TextEncoder().encode(text);

describe("web/verify-core.mjs ↔ lib 교차 검증", () => {
  let core: Core;
  before(async () => {
    core = await import("../web/verify-core.mjs");
  });

  async function sealedLedger(count: number) {
    let now = Date.parse("2026-10-28T09:00:00Z");
    const ledger = new Ledger(new MemoryStore(), () => (now += 777));
    const ids = Array.from({ length: count }, (_, i) => `VR-2026-10-${String(i + 1).padStart(4, "0")}`);
    for (const id of ids) await ledger.submit(id, hashReportBytes(bytes(`report ${id}`)));
    const block = await ledger.seal();
    return { ledger, ids, block };
  }

  it("파일 해시, 블록 해시, 앵커 키가 동일", async () => {
    const { block } = await sealedLedger(3);
    expect(await core.hashFile(bytes("정산 리포트 ✓"))).to.equal(hashReportBytes(bytes("정산 리포트 ✓")));
    expect(await core.blockHash(headerOf(block))).to.equal(blockHash(headerOf(block)));
    expect(core.blockAnchorKey(7)).to.equal(blockAnchorKey(7));
  });

  it("블록 크기 1~12, 모든 영수증에서 원본·변조 판정이 동일", async () => {
    for (let n = 1; n <= 12; n++) {
      const { ledger, ids } = await sealedLedger(n);
      for (const id of ids) {
        const receipt = await ledger.receipt(id);
        const original = hashReportBytes(bytes(`report ${id}`));
        const tampered = hashReportBytes(bytes(`report ${id} (수정됨)`));

        const cases: [Receipt, string][] = [
          [receipt, original],
          [receipt, tampered],
          [{ ...receipt, reportHash: tampered }, tampered],
          [{ ...receipt, reportId: id + "X" }, original],
          [{ ...receipt, block: { ...receipt.block, createdAt: receipt.block.createdAt + 1 } }, original],
          [{ ...receipt, version: "VB-LEDGER-v0" }, original],
        ];
        for (const [r, fileHash] of cases) {
          expect(await core.verifyReceipt(r, fileHash), `n=${n} ${id}`).to.deep.equal(verifyReceipt(r, fileHash));
        }
        expect((await core.verifyReceipt(receipt, original)).ok).to.equal(true);
      }
    }
  });

  it("inspectReceipt: 실패한 단계 이후는 확인하지 않음(null)", async () => {
    const { ledger } = await sealedLedger(2);
    const receipt = await ledger.receipt("VR-2026-10-0001");
    const { steps, result } = await core.inspectReceipt(receipt, hashReportBytes(bytes("다른 파일")));
    expect(result).to.deep.equal({ ok: false, reason: "HASH_MISMATCH" });
    expect(steps).to.deep.equal({ version: true, hashMatch: false, proofValid: null, blockHashValid: null });
  });

  it("parseReceipt: 깨진 JSON·다른 형식은 안내 메시지로 거부, 발급된 영수증은 통과", async () => {
    const { ledger } = await sealedLedger(1);
    const receipt = await ledger.receipt("VR-2026-10-0001");
    expect(core.parseReceipt(JSON.stringify(receipt))).to.deep.equal(receipt);
    expect(() => core.parseReceipt("{not json")).to.throw("JSON 형식이 아닙니다");
    expect(() => core.parseReceipt(JSON.stringify({ hello: "world" }))).to.throw("영수증 형식이 아닙니다");
    expect(() => core.parseReceipt(JSON.stringify({ ...receipt, proof: [{ hash: "0x00", position: "up" }] })))
      .to.throw("영수증 형식이 아닙니다");
  });

  it("증명 안의 해시 형식이 깨져 있으면 예외 대신 PROOF_INVALID", async () => {
    const { ledger } = await sealedLedger(2);
    const receipt = await ledger.receipt("VR-2026-10-0001");
    const broken = { ...receipt, proof: [{ hash: "0x1234", position: "right" as const }] };
    expect(await core.verifyReceipt(broken, receipt.reportHash)).to.deep.equal({ ok: false, reason: "PROOF_INVALID" });
  });
});
