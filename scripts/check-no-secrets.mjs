import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const rules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["Supabase secret key", /sb_secret_(?!test-only\b)[A-Za-z0-9_-]{20,}/],
  ["service-role assignment", /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'](?!YOUR_|REPLACE_|<)[^"'$\s]{20,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
  ["credentialed database URL", /\bpostgres(?:ql)?(?:\+\w+)?:\/\/[^/\s:@]+:[^@\s/]+@/i],
  ["signed resource URL", /[?&](?:token|signature|x-amz-signature)=[A-Za-z0-9_%.-]{16,}/i],
];

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter(Boolean);
const findings = [];
for (const file of files) {
  let source;
  try { source = readFileSync(file, "utf8"); } catch { continue; }
  if (source.includes("\0")) continue;
  for (const [name, pattern] of rules) if (pattern.test(source)) findings.push(`${name}: ${file}`);
}
if (findings.length) {
  console.error(`Secret scan failed (${findings.length} redacted finding(s)):\n${findings.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed across ${files.length} repository files; no credential material was found.`);
}
