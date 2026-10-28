import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// .env의 DATABASE_URL 비밀번호 자리를 채운다. 입력한 글자는 화면에 표시하지 않는다.
// 비밀번호의 특수문자는 URL 인코딩해서 넣는다.
const ENV = process.env.ENV_FILE || join(__dirname, "..", ".env");
const URL_LINE = /^DATABASE_URL=(postgres(?:ql)?:\/\/[^:\s]+:)(.*)(@[^@\s]+)$/m;

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") process.exit(130); // Ctrl+C
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const env = readFileSync(ENV, "utf8");
  const match = env.match(URL_LINE);
  if (!match) {
    console.error(".env에서 DATABASE_URL=postgresql://사용자:비밀번호@호스트 형식의 줄을 찾지 못했습니다.");
    process.exitCode = 1;
    return;
  }
  const password = await readHidden("Supabase DB 비밀번호를 입력하고 Enter를 누르세요: ");
  if (!password) {
    console.error("비밀번호가 비어 있어 아무것도 바꾸지 않았습니다.");
    process.exitCode = 1;
    return;
  }
  const line = `DATABASE_URL=${match[1]}${encodeURIComponent(password)}${match[3]}`;
  writeFileSync(ENV, env.replace(URL_LINE, () => line));
  console.log(`.env에 저장했습니다. (비밀번호 ${password.length}자)`);
}

main();
