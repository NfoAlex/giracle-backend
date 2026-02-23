-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ServerConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "introduction" TEXT NOT NULL,
    "RegisterAvailable" BOOLEAN NOT NULL DEFAULT true,
    "RegisterInviteOnly" BOOLEAN NOT NULL DEFAULT true,
    "RegisterAnnounceChannelId" TEXT NOT NULL DEFAULT '',
    "MessageMaxLength" INTEGER NOT NULL DEFAULT 3000,
    "MessageMaxFileSize" INTEGER NOT NULL DEFAULT 512000
);
INSERT INTO "new_ServerConfig" ("MessageMaxLength", "RegisterAnnounceChannelId", "RegisterAvailable", "RegisterInviteOnly", "id", "introduction", "name") SELECT "MessageMaxLength", "RegisterAnnounceChannelId", "RegisterAvailable", "RegisterInviteOnly", "id", "introduction", "name" FROM "ServerConfig";
DROP TABLE "ServerConfig";
ALTER TABLE "new_ServerConfig" RENAME TO "ServerConfig";
CREATE TABLE "new_Token" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL DEFAULT 'ログイン情報',
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Token" ("createdAt", "id", "token", "userId") SELECT "createdAt", "id", "token", "userId" FROM "Token";
DROP TABLE "Token";
ALTER TABLE "new_Token" RENAME TO "Token";
CREATE UNIQUE INDEX "Token_token_key" ON "Token"("token");
CREATE INDEX "Token_userId_idx" ON "Token"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
