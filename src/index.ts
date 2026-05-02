import { cors } from "@elysiajs/cors";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { Elysia, status } from "elysia";
import { PrismaClient } from "../prisma/generated/client";
import { Middleware } from "./Middlewares";

import { channel } from "./components/Channel/channel.module";
import { message } from "./components/Message/message.module";
import { role } from "./components/Role/role.module";
import { server } from "./components/Server/server.module";
import { user } from "./components/User/user.module";
import { wsHandler } from "./ws";

//ユーザーアップロード用のディレクトリ作成
import { mkdir } from "node:fs/promises";
await mkdir("./STORAGE", { recursive: true }).catch((e) => { });
await mkdir("./STORAGE/file", { recursive: true }).catch((e) => { });
await mkdir("./STORAGE/icon", { recursive: true }).catch((e) => { });
await mkdir("./STORAGE/banner", { recursive: true }).catch((e) => { });
await mkdir("./STORAGE/custom-emoji", { recursive: true }).catch((e) => { });

const adapter = new PrismaLibSql(
  { url: process.env.DATABASE_URL || "file:./dev.db" },
  { timestampFormat: "unixepoch-ms" },
);
export const db = new PrismaClient({ adapter });

export const app = new Elysia()
  .use(
    cors({
      origin: Bun.env.CORS_ORIGIN,
    }),
  )
  .use(Bun.env.RATE_LIMIT_ENABLED === "true" ? Middleware.RateLimiter : undefined)
  .onError(({ error, code }) => {
    if (code === "NOT_FOUND") return status(404, "Not Found :(");
    process.env.NODE_ENV !== "test" && console.error("index :: エラー->", error);
    if (typeof code === "number")
      return status(code, error.response || "somethin went wrong :(");
    return status(500, "somethin went wrong :(");
  })
  .use(wsHandler)
  .use(user)
  .use(channel)
  .use(role)
  .use(message)
  .use(server)
  .listen(3000);

console.log("Server running at http://localhost:3000");
