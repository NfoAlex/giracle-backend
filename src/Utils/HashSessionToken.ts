import crypto from "node:crypto";

/**
 * セッショントークンをDB保存用のハッシュへ変換する
 * 高エントロピー乱数なので低速KDF(Argon2)は不要。DB漏洩時の再利用防止が目的なのでSHA-256で足りる
 */
export default function HashSessionToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
