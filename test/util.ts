import { execSync } from "node:child_process";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../prisma/generated/client";
import { app } from "../src";

export const adapter = new PrismaLibSql(
  { url: process.env.DATABASE_URL || "file:./test.db" },
  { timestampFormat: "unixepoch-ms" }
);

let FLAG_INIT_COMPLETED = false;

/**
 * 全テスト共通のDB初期化処理。
 */
export async function INIT() {
  if (FLAG_INIT_COMPLETED) return;
  FLAG_INIT_COMPLETED = true;

  const db = new PrismaClient({ adapter });

  // --- 01.auth: DBリセット + シード + ユーザー/トークン作成 ---
  execSync("bunx prisma db push --accept-data-loss");

  await db.token.deleteMany({});
  await db.password.deleteMany({});
  await db.channelViewableRole.deleteMany({});
  await db.channelJoin.deleteMany({});
  await db.inbox.deleteMany({});
  await db.messageReadTime.deleteMany({});
  await db.messageReaction.deleteMany({});
  await db.messageUrlPreview.deleteMany({});
  await db.message.deleteMany({});
  await db.roleLink.deleteMany({});
  await db.roleInfo.deleteMany({});
  await db.channel.deleteMany({});
  await db.invitation.deleteMany({});
  await db.user.deleteMany({});
  await db.serverConfig.deleteMany({});

  execSync("bun ./prisma/seeds.ts");

  await db.user.createMany({
    data: [
      { id: "TESTUSER", name: "testsystemuser", selfIntroduction: "" },
      { id: "TESTUSER2", name: "testsystemuser2", selfIntroduction: "" },
    ],
  });
  await db.token.createMany({
    data: [
      { userId: "TESTUSER", token: "TESTUSERTOKEN" },
      { userId: "TESTUSER", token: "TESTUSERTOKEN_FOR_SIGNOUT_TEST" },
      { userId: "TESTUSER", token: "TESTUSERTOKEN_FOR_DELETION_TEST" },
      { userId: "TESTUSER2", token: "TESTUSER2TOKEN" },
    ],
  });
  await db.invitation.create({
    data: { inviteCode: "testinvite", createdUserId: "SYSTEM" },
  });

  // --- 02.channel: チャンネル/メッセージ/ロール作成 ---
  await db.channel.createMany({
    data: [
      { id: "TESTCHANNEL1", name: "General", description: "General channel", createdUserId: "TESTUSER" },
      { id: "TESTCHANNEL2", name: "Random", description: "Random discussions", createdUserId: "TESTUSER" },
      { id: "TESTCHANNEL3", name: "Private Channel", description: "Private discussions", createdUserId: "TESTUSER" },
    ],
  });
  await db.message.upsert({
    where: { id: "TESTMESSAGE1" },
    create: { id: "TESTMESSAGE1", channelId: "TESTCHANNEL1", content: "Welcome to the General channel!", userId: "TESTUSER" },
    update: {},
  });
  await db.message.upsert({
    where: { id: "TESTMESSAGE2" },
    create: { id: "TESTMESSAGE2", channelId: "TESTCHANNEL2", content: "Feel free to chat here.", userId: "TESTUSER" },
    update: {},
  });
  await db.message.upsert({
    where: { id: "TESTMESSAGE3" },
    create: { id: "TESTMESSAGE3", channelId: "TESTCHANNEL3", content: "Secret message.", userId: "TESTUSER" },
    update: {},
  });
  await db.channelJoin.createMany({
    data: [
      { userId: "TESTUSER", channelId: "TESTCHANNEL1" },
      { userId: "TESTUSER2", channelId: "TESTCHANNEL2" },
    ],
  });
  await db.roleInfo.create({
    data: { id: "ChannelManage", name: "Channel Manage Role", createdUserId: "TESTUSER", manageChannel: true },
  });
  await db.roleLink.create({ data: { userId: "TESTUSER", roleId: "ChannelManage" } });
  await db.roleInfo.create({
    data: { id: "ChannelPrivateViewer", name: "Channel Private Viewer Role", createdUserId: "TESTUSER" },
  });
  await db.roleLink.create({ data: { userId: "TESTUSER", roleId: "ChannelPrivateViewer" } });
  await db.channelViewableRole.create({ data: { channelId: "TESTCHANNEL3", roleId: "ChannelPrivateViewer" } });

  // --- 03.role: ロール管理権限付与 ---
  await db.roleInfo.create({
    data: { id: "RoleManage", name: "Role Manage Role", createdUserId: "TESTUSER", manageRole: true },
  });
  await db.roleLink.create({ data: { roleId: "RoleManage", userId: "TESTUSER" } });

  // --- 04.message: メッセージ関連データ追加 ---
  await db.messageReadTime.deleteMany({});
  await db.messageReaction.deleteMany({});
  await db.messageUrlPreview.deleteMany({});
  await db.message.deleteMany({ where: { channelId: "TESTCHANNEL1" } });

  await db.message.upsert({
    where: { id: "TESTMESSAGE1" },
    create: { id: "TESTMESSAGE1", channelId: "TESTCHANNEL1", content: "Welcome to the General channel!", userId: "TESTUSER" },
    update: {},
  });
  await db.message.upsert({
    where: { id: "TESTMESSAGE2" },
    create: { id: "TESTMESSAGE2", channelId: "TESTCHANNEL1", content: "Feel free to chat here.", userId: "TESTUSER" },
    update: {},
  });

  // await db.roleInfo.upsert({
  //   where: { id: "CHANNELVIEWABLEROLE1" },
  //   create: { id: "CHANNELVIEWABLEROLE1", name: "channelviewablerole1", createdUserId: "SYSTEM" },
  //   update: {},
  // });
  // await db.channelViewableRole.upsert({
  //   where: { channelId_roleId: { channelId: "TESTCHANNEL1", roleId: "CHANNELVIEWABLEROLE1" } },
  //   create: { channelId: "TESTCHANNEL1", roleId: "CHANNELVIEWABLEROLE1" },
  //   update: {},
  // });
  // await db.roleLink.upsert({
  //   where: { userId_roleId: { userId: "TESTUSER", roleId: "CHANNELVIEWABLEROLE1" } },
  //   create: { userId: "TESTUSER", roleId: "CHANNELVIEWABLEROLE1" },
  //   update: {},
  // });
  await db.inbox.upsert({
    where: { messageId_userId: { messageId: "TESTMESSAGE1", userId: "TESTUSER" } },
    create: { type: "message", messageId: "TESTMESSAGE1", userId: "TESTUSER" },
    update: {},
  });
  await db.inbox.upsert({
    where: { messageId_userId: { messageId: "TESTMESSAGE1", userId: "TESTUSER2" } },
    create: { type: "message", messageId: "TESTMESSAGE1", userId: "TESTUSER2" },
    update: {},
  });
}

export async function FETCH({
  path,
  method,
  body,
  useSecondaryUser = false,
  excludeCredential = false,
}: {
  path: `/${string}`;
  method: "GET" | "POST" | "PUT" | "DELETE";
  // biome-ignore lint/suspicious/noExplicitAny: for test
  body?: any;
  useSecondaryUser?: boolean;
  excludeCredential?: boolean;
}): Promise<Response> {
  const tokenUsing = useSecondaryUser ? "TESTUSER2TOKEN" : "TESTUSERTOKEN";
  const isFormData = body instanceof FormData;

  return await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        Cookie: excludeCredential ? "" : `token=${tokenUsing}`,
      },
      body: isFormData ? body : JSON.stringify(body),
    }),
  );
}
