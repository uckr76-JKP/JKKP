import "../styles/verifica-home.css";

type BusinessCardProps = {
  number: string;
  label: string;
  title: string;
  description: string;
  flow: string[];
  href: string;
  tone: "blue" | "teal";
};

function BusinessCard({
  number,
  label,
  title,
  description,
  flow,
  href,
  tone,
}: BusinessCardProps) {
  return (
    <article className={`vb-card vb-card--${tone}`}>
      <div className="vb-card__top">
        <span className="vb-card__number">{number}</span>
        <span className="vb-pill">{label}</span>
      </div>

      <h3>{title}</h3>
      <p className="vb-card__copy">{description}</p>

      <div className="vb-flow" aria-label={`${title} 처리 흐름`}>
        {flow.map((item, index) => (
          <div className="vb-flow__item" key={item}>
            <span>{item}</span>
            {index < flow.length - 1 && <b aria-hidden="true">→</b>}
          </div>
        ))}
      </div>

      <a className="vb-text-link" href={href}>
        자세히 보기 <span aria-hidden="true">→</span>
      </a>
    </article>
  );
}

const engineSteps = [
  {
    no: "01",
    en: "CONNECT",
    title: "데이터 연결",
    text: "플랫폼·POS·엑셀·계약 데이터를 하나의 정산 흐름으로 연결합니다.",
  },
  {
    no: "02",
    en: "CALCULATE",
    title: "정산 계산",
    text: "계약 조건과 수익배분 기준을 반영해 정산 금액을 계산합니다.",
  },
  {
    no: "03",
    en: "VERIFY",
    title: "정산 검증",
    text: "원천 데이터와 계산 과정을 대조해 차이와 확인 포인트를 찾습니다.",
  },
  {
    no: "04",
    en: "REPORT",
    title: "검증 리포트",
    text: "Source · Logic · Result를 구조화해 확인 가능한 리포트로 남깁니다.",
  },
];

const proofSteps = [
  {
    no: "01",
    en: "REPORT",
    title: "검증 리포트 확정",
    text: "Source · Logic · Result가 담긴 정산 검증 리포트를 확정합니다.",
  },
  {
    no: "02",
    en: "HASH",
    title: "디지털 지문 생성",
    text: "리포트 전체를 SHA-256 해시값으로 변환합니다. 한 글자만 바뀌어도 값이 달라집니다.",
  },
  {
    no: "03",
    en: "ANCHOR",
    title: "블록체인 기록",
    text: "원본 데이터가 아닌 해시값과 기록 시점만 블록체인에 남깁니다.",
  },
  {
    no: "04",
    en: "CHECK",
    title: "정산 당사자 대조 확인",
    text: "정산 당사자는 받은 리포트의 해시값을 체인 기록과 대조해 변경 여부를 확인합니다.",
  },
];

export default function VerificaLanding() {
  return (
    <div className="vb-site">
      <header className="vb-header">
        <div className="vb-shell vb-header__inner">
          <a href="#top" className="vb-brand" aria-label="베리피카브릿지 홈">
            <span className="vb-brand__mark">VB</span>
            <span className="vb-brand__name">
              베리피카브릿지(주)
              <small>VERIFICA BRIDGE</small>
            </span>
          </a>

          <nav className="vb-nav" aria-label="주요 메뉴">
            <a href="#business">서비스</a>
            <a href="#ip">IP 정산</a>
            <a href="#royalty">브랜드·프랜차이즈</a>
            <a href="#report">검증 리포트</a>
            <a href="#proof">블록체인 검증</a>
            <a href="#pricing">이용안내</a>
          </nav>

          <a className="vb-btn vb-btn--small" href="#contact">
            도입 문의
          </a>
        </div>
      </header>

      <main id="top">
        <section className="vb-hero">
          <div className="vb-shell vb-hero__grid">
            <div className="vb-hero__copy">
              <span className="vb-eyebrow">SETTLEMENT · VERIFICATION · REPORT</span>
              <h1>
                복잡한 정산을,
                <br />
                <em>명확한 기준으로.</em>
              </h1>
              <p>
                IP부터 패션브랜드·프랜차이즈까지. 흩어진 매출과 로열티 데이터를
                연결하고, 계산하고, 검증합니다.
              </p>
              <div className="vb-actions">
                <a className="vb-btn" href="#business">서비스 살펴보기</a>
                <a className="vb-btn vb-btn--ghost" href="#contact">도입 문의하기</a>
              </div>
              <div className="vb-hero__tags">
                <span>IP SETTLEMENT</span>
                <span>ROYALTY</span>
                <span>VERIFICATION REPORT</span>
                <span>ON-CHAIN PROOF</span>
              </div>
            </div>

            <div className="vb-dashboard" aria-label="정산 대시보드 예시">
              <div className="vb-dashboard__head">
                <div>
                  <span className="vb-dashboard__label">SETTLEMENT OVERVIEW</span>
                  <strong>정산 흐름 미리보기</strong>
                </div>
                <span className="vb-status">LIVE</span>
              </div>
              <div className="vb-dashboard__metric">
                <span>이번 정산 주기</span>
                <strong>Revenue → Contract → Settlement</strong>
              </div>
              <div className="vb-dashboard__rows">
                <div><span>Source</span><b>원천 매출 데이터</b><i>✓</i></div>
                <div><span>Logic</span><b>계약 조건 · 수익배분</b><i>✓</i></div>
                <div><span>Verify</span><b>정산 결과 대조</b><i>✓</i></div>
                <div><span>Report</span><b>검증 리포트 생성</b><i>✓</i></div>
              </div>
            </div>
          </div>
        </section>

        <section className="vb-section" id="business">
          <div className="vb-shell">
            <div className="vb-section-head">
              <span className="vb-eyebrow">TWO BUSINESSES. ONE STANDARD.</span>
              <h2>산업은 달라도, 정산의 기준은 하나입니다.</h2>
              <p>두 개의 사업영역을 하나의 정산·검증 구조로 연결합니다.</p>
            </div>

            <div className="vb-card-grid">
              <BusinessCard
                number="01"
                label="IP SETTLEMENT"
                title="IP 수익의 흐름을 한눈에."
                description="웹툰·웹소설·콘텐츠·라이선스 사업의 매출과 계약 데이터를 연결해 인세와 수익배분을 계산하고 검증합니다."
                flow={["매출", "계약", "인세", "검증", "Report"]}
                href="#ip"
                tone="blue"
              />
              <BusinessCard
                number="02"
                label="BRAND & FRANCHISE"
                title="로열티의 흐름을 더 명확하게."
                description="패션브랜드·라이선스·프랜차이즈의 매출과 계약조건을 연결해 로열티를 산정하고 정산 과정을 검증합니다."
                flow={["매출", "계약", "로열티", "검증", "Report"]}
                href="#royalty"
                tone="teal"
              />
            </div>
          </div>
        </section>

        <section className="vb-engine">
          <div className="vb-shell">
            <div className="vb-engine__head">
              <span className="vb-eyebrow vb-eyebrow--light">VERIFICA ENGINE</span>
              <h2>하나의 흐름으로, 정산을 더 명확하게.</h2>
            </div>
            <div className="vb-engine__grid">
              {engineSteps.map((step) => (
                <article key={step.no}>
                  <span className="vb-engine__no">{step.no}</span>
                  <small>{step.en}</small>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="vb-section vb-section--soft" id="report">
          <div className="vb-shell vb-split">
            <div className="vb-report-card">
              <div className="vb-report-card__top">
                <div>
                  <small>VERIFICATION REPORT</small>
                  <strong>Settlement Report</strong>
                </div>
                <span>VERIFIED</span>
              </div>
              <dl>
                <div><dt>Source</dt><dd>Platform Sales Data</dd></div>
                <div><dt>Contract</dt><dd>Revenue Share Rule</dd></div>
                <div><dt>Calculation</dt><dd>Revenue × Contract Rate</dd></div>
                <div><dt>Proof</dt><dd>On-chain Hash Anchored</dd></div>
                <div className="vb-report-card__result"><dt>Result</dt><dd>Settlement Confirmed</dd></div>
              </dl>
            </div>

            <div className="vb-split__copy">
              <span className="vb-eyebrow">VERIFICATION REPORT</span>
              <h2>계산에서 끝내지 않습니다.<br /><em>정산의 근거까지 남깁니다.</em></h2>
              <p>
                매출 데이터와 계약조건, 계산 과정과 결과를 연결해 정산 내역을
                확인할 수 있는 검증 리포트로 구조화합니다.
              </p>
              <div className="vb-inline-points">
                <div><b>SOURCE</b><span>어떤 데이터에서 시작됐는지</span></div>
                <div><b>LOGIC</b><span>어떤 조건이 적용됐는지</span></div>
                <div><b>RESULT</b><span>왜 이 결과가 나왔는지</span></div>
              </div>
              <blockquote>정산 결과가 아니라, 정산의 과정을 보여줍니다.</blockquote>
            </div>
          </div>
        </section>

        <section className="vb-proof" id="proof">
          <div className="vb-shell">
            <div className="vb-proof__grid">
              <div className="vb-proof__copy">
                <span className="vb-eyebrow vb-eyebrow--light">BLOCKCHAIN-BASED VERIFICATION</span>
                <h2>검증한 정산은,<br /><em>누구도 바꿀 수 없게.</em></h2>
                <p>
                  확정된 검증 리포트의 디지털 지문(해시값)을 블록체인에 기록합니다.
                  정산 당사자는 서로 같은 리포트를 받았는지, 기록 이후 바뀐 내용은
                  없는지 직접 확인할 수 있습니다.
                </p>
                <ul className="vb-proof__points">
                  <li><b>위·변조 확인</b><span>리포트가 기록 이후 수정됐는지 해시값 대조로 확인</span></li>
                  <li><b>원본 비공개</b><span>매출·계약 데이터는 체인에 올리지 않고 해시값만 기록</span></li>
                  <li><b>시점 증명</b><span>정산 리포트가 언제 확정됐는지 블록 기록으로 남김</span></li>
                </ul>
              </div>

              <div className="vb-proof-card" aria-label="블록체인 검증 기록 예시">
                <div className="vb-proof-card__top">
                  <div>
                    <small>ON-CHAIN PROOF</small>
                    <strong>Report Integrity Check</strong>
                  </div>
                  <span>MATCH</span>
                </div>
                <dl>
                  <div><dt>Report ID</dt><dd>VR-2026-10-0001</dd></div>
                  <div><dt>Report Hash</dt><dd><code>9f2c…e41a</code></dd></div>
                  <div><dt>On-chain Hash</dt><dd><code>9f2c…e41a</code></dd></div>
                  <div><dt>Anchored</dt><dd>2026-10-27 14:32 KST</dd></div>
                </dl>
                <p className="vb-proof-card__result">
                  리포트 해시값과 체인 기록이 일치합니다. 기록 이후 변경된 내용이 없습니다.
                </p>
                <small className="vb-proof-card__note">* 화면은 예시이며, 실제 값은 리포트별로 발급됩니다.</small>
              </div>
            </div>

            <div className="vb-proof__steps">
              {proofSteps.map((step) => (
                <article key={step.no}>
                  <span className="vb-engine__no">{step.no}</span>
                  <small>{step.en}</small>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="vb-section" id="ip">
          <div className="vb-shell vb-detail">
            <div>
              <span className="vb-eyebrow">FOR IP BUSINESS</span>
              <h2>콘텐츠 수익이 발생하는 순간부터<br />창작자 정산까지.</h2>
              <p>
                플랫폼·CP·IP 사업자와 창작자 사이의 복잡한 수익배분 구조를
                데이터 기반의 정산 흐름으로 연결합니다.
              </p>
              <div className="vb-chip-row">
                <span>WEBTOON</span><span>WEB NOVEL</span><span>CONTENT</span><span>LICENSE</span><span>CHARACTER IP</span>
              </div>
            </div>
            <div className="vb-process">
              <div><span>01</span><b>Platform Revenue</b><small>플랫폼 매출</small></div>
              <div><span>02</span><b>Contract Rule</b><small>계약 · 수익배분 조건</small></div>
              <div><span>03</span><b>Settlement</b><small>인세 · 지급액 계산</small></div>
              <div><span>04</span><b>Verification</b><small>정산 검증 · 리포트</small></div>
            </div>
          </div>
        </section>

        <section className="vb-section vb-section--soft" id="royalty">
          <div className="vb-shell vb-detail vb-detail--reverse">
            <div className="vb-process vb-process--teal">
              <div><span>01</span><b>Store / Partner Sales</b><small>매장 · 가맹점 · 파트너 매출</small></div>
              <div><span>02</span><b>Royalty Rule</b><small>계약 · 로열티율</small></div>
              <div><span>03</span><b>Royalty Settlement</b><small>로열티 산정 · 정산</small></div>
              <div><span>04</span><b>Verification</b><small>검증 · 리포트</small></div>
            </div>
            <div>
              <span className="vb-eyebrow vb-eyebrow--teal">FOR BRAND & FRANCHISE</span>
              <h2>매출이 발생하는 순간부터<br />로열티 정산까지.</h2>
              <p>
                패션브랜드·라이선스·프랜차이즈의 매출 데이터를 계약조건과 연결해
                로열티를 산정하고 정산 과정을 확인할 수 있도록 구조화합니다.
              </p>
              <div className="vb-chip-row">
                <span>FASHION</span><span>FRANCHISE</span><span>LICENSE</span><span>BRAND</span><span>RETAIL</span>
              </div>
            </div>
          </div>
        </section>

        <section className="vb-section" id="pricing">
          <div className="vb-shell">
            <div className="vb-pricing">
              <div className="vb-pricing__intro">
                <span className="vb-eyebrow">GET STARTED</span>
                <h2>기업에 맞는 방식으로 시작하세요.</h2>
                <p>
                  정산 대상, 데이터 규모, 검증 범위에 따라 적합한 이용방식을 안내합니다.
                </p>
              </div>

              <div className="vb-plan-grid">
                <article><span>01</span><h3>정기 이용</h3><p>월·연 단위 서비스 이용</p></article>
                <article><span>02</span><h3>프로젝트</h3><p>특정 정산 업무 단위 이용</p></article>
                <article><span>03</span><h3>Enterprise</h3><p>기업별 맞춤 계약 및 연동</p></article>
              </div>

              <div className="vb-payment">
                <div>
                  <small>PAYMENT</small>
                  <strong>결제방법</strong>
                </div>
                <p>신용카드 <span>·</span> 계좌이체 <span>·</span> 세금계산서</p>
                <small>기업 계약 및 별도 구축 건은 계약 조건에 따라 결제 방식이 달라질 수 있습니다.</small>
              </div>
            </div>
          </div>
        </section>

        <section className="vb-final" id="contact">
          <div className="vb-shell vb-final__inner">
            <div>
              <span className="vb-eyebrow vb-eyebrow--light">START WITH VERIFICA BRIDGE</span>
              <h2>지금의 정산 방식,<br />그대로 연결하세요.</h2>
              <p>엑셀부터 플랫폼 데이터까지, 현재 구조를 바탕으로 더 명확한 정산 흐름을 설계합니다.</p>
            </div>
            <a className="vb-btn vb-btn--white" href="mailto:hello@brand-chain.net">도입 상담하기 →</a>
          </div>
        </section>
      </main>

      <footer className="vb-footer">
        <div className="vb-shell vb-footer__inner">
          <div>
            <b>베리피카브릿지 주식회사</b>
            <span>VERIFICA BRIDGE Co., Ltd.</span>
          </div>
          <div className="vb-footer__links">
            <a href="#pricing">이용안내</a>
            <a href="#contact">문의하기</a>
            <a href="/terms">이용약관</a>
            <a href="/privacy"><b>개인정보처리방침</b></a>
          </div>
        </div>
        <div className="vb-shell vb-footer__biz">
          <p>
            <span>대표자 박정규</span>
            <span>사업자등록번호 415-81-60951</span>
            <span>고객센터 <a href="mailto:hello@brand-chain.net">hello@brand-chain.net</a></span>
          </p>
          <p>
            <span>주소 경기도 고양시 덕양구 보광로12번길 21, 102호</span>
          </p>
          <small>© 2026 Verifica Bridge. All rights reserved.</small>
        </div>
      </footer>
    </div>
  );
}
