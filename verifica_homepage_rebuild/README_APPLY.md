# 베리피카브릿지 홈페이지 개편 1차 적용본

## 이번 적용의 핵심
현재 공개 홈페이지의 정보 구조를 기준으로, 방문자가 먼저 **두 사업축**을 이해하도록 재배치했습니다.

1. HERO — 복잡한 정산을, 명확한 기준으로.
2. TWO BUSINESSES — IP 정산 / 패션브랜드·프랜차이즈 로열티 정산
3. VERIFICA ENGINE — Connect → Calculate → Verify → Report
4. VERIFICATION REPORT — Source / Logic / Result
4-1. BLOCKCHAIN-BASED VERIFICATION (`#proof`) — 리포트 해시값 온체인 기록 → 위·변조 대조
5. IP 상세
6. Brand & Franchise 상세
7. 이용방식 + 결제방법
8. 도입상담 CTA

## 왜 이렇게 바꿨나
기존 공개 페이지에는 `99.99% 정산 정확도`, `월 800+`, `95% 시간 절감`, `2019/2022/2026 연혁` 같은 수치·연혁과 `감사` 표현이 강하게 노출되어 있습니다.
증빙이 확실한 항목만 다시 넣는 편이 좋고, 전면 카피는 `감사`보다 **정산 검증 / 검증 리포트**를 중심으로 설계했습니다.

## 파일
- `src/components/VerificaLanding.tsx` — 전체 랜딩페이지 React/TS 컴포넌트
- `src/styles/verifica-home.css` — 외부 UI 라이브러리 없이 동작하는 스타일
- `examples/nextjs-page.tsx` — Next.js App Router 예시
- `examples/vite-App.tsx` — React/Vite 예시
- `preview.html` — 브라우저로 바로 열어볼 수 있는 정적 미리보기

## Next.js 프로젝트라면
1. `VerificaLanding.tsx`를 프로젝트의 `src/components/`로 복사
2. `verifica-home.css`를 `src/styles/`로 복사
3. 홈 페이지를 아래처럼 연결

```tsx
import VerificaLanding from "@/components/VerificaLanding";

export default function HomePage() {
  return <VerificaLanding />;
}
```

`@/` alias가 없다면 상대경로를 사용하세요.

## React/Vite 프로젝트라면
```tsx
import VerificaLanding from "./components/VerificaLanding";

export default function App() {
  return <VerificaLanding />;
}
```

## 현재 프로젝트에 정확히 맞추기 위해 필요한 것
현재 저장소가 `SRC` 폴더와 Supabase 구성을 사용해 온 것은 확인됐지만, 이 대화에서는 `package.json`과 실제 라우팅 파일 구조가 보이지 않습니다.
따라서 이번 버전은 **React/TypeScript 어디에나 붙이기 쉬운 무의존성 컴포넌트 + CSS**로 만들었습니다.

다음 중 하나만 올려주면 실제 저장소에 1:1로 맞춰 드릴 수 있습니다.
- `package.json`
- 저장소 루트 화면 캡처
- `src` 폴더 트리

API 키나 `.env` 실제 값은 올릴 필요가 없습니다.

## 적용 전에 반드시 확인할 부분
- 결제방법: 실제 제공하는 방식만 남기기
- `도입 상담하기` 메일 링크 또는 문의 폼 연결
- 실제 CI 이미지로 헤더의 임시 `VB` 마크 교체
- 개인정보처리방침/이용약관/사업자정보 링크 연결
- 실증되지 않은 성과 수치·고객 수·연혁은 검증 후 노출
- 블록체인 검증 섹션: 실제 사용하는 체인(네트워크)명·해시 알고리즘이 확정되면 문구 반영, 예시 해시/일시는 실제 발급 화면 캡처로 교체 검토
- 블록체인 검증 섹션: 문구는 "정산 당사자 확인" 기준. 실제 기록·대조 기능은 `../onchain/` 참고
