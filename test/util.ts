import fs from "node:fs/promises";
import { $ } from "bun";
import { eq } from "drizzle-orm";
import { app } from "../src";
import { db } from "../src/db";
import {
  channelJoinOnDefaults,
  channelJoins,
  channelMutes,
  channels,
  channelViewableRoles,
  customEmojis,
  inboxes,
  invitations,
  messageFileAttached,
  messageReactions,
  messageReadTimes,
  messages,
  messageUrlPreviews,
  notificationConfigs,
  notificationDevices,
  passwords,
  requestLog,
  roleInfos,
  roleLinks,
  serverConfigs,
  tokens,
  users,
} from "../src/db/schema";

let FLAG_INIT_COMPLETED = false;

/**
 * 全テスト共通のDB初期化処理。
 */
export async function INIT() {
  if (FLAG_INIT_COMPLETED) return;
  FLAG_INIT_COMPLETED = true;

  // --- 01.auth: DBリセット + シード + ユーザー/トークン作成 ---
  await $`bunx drizzle-kit migrate`;

  await db.delete(tokens);
  await db.delete(passwords);
  await db.delete(channelViewableRoles);
  await db.delete(channelJoins);
  await db.delete(channelMutes);
  await db.delete(channelJoinOnDefaults);
  await db.delete(messageFileAttached);
  await db.delete(notificationDevices);
  await db.delete(notificationConfigs);
  await db.delete(customEmojis);
  await db.delete(requestLog);
  await db.delete(inboxes);
  await db.delete(messageReadTimes);
  await db.delete(messageReactions);
  await db.delete(messageUrlPreviews);
  await db.delete(messages);
  await db.delete(roleLinks);
  await db.delete(roleInfos);
  await db.delete(channels);
  await db.delete(invitations);
  await db.delete(users);
  await db.delete(serverConfigs);

  await fs.rm("./STORAGE/file/TESTCHANNEL1", { recursive: true, force: true }); //テストチャンネルのアップロードファイル削除
  await $`bun ./src/db/seeds.ts`;

  await db.insert(users).values([
    { id: "TESTUSER", name: "testsystemuser", selfIntroduction: "" },
    { id: "TESTUSER2", name: "testsystemuser2", selfIntroduction: "" },
  ]);
  await db.insert(tokens).values([
    { userId: "TESTUSER", token: "TESTUSERTOKEN" },
    { userId: "TESTUSER", token: "TESTUSERTOKEN_FOR_SIGNOUT_TEST" },
    { userId: "TESTUSER", token: "TESTUSERTOKEN_FOR_DELETION_TEST" },
    { userId: "TESTUSER2", token: "TESTUSER2TOKEN" },
    {
      userId: "TESTUSER2",
      token: "TESTUSER2TOKEN_EXPIRED",
      expiresAt: new Date(Date.now() - 60 * 1000),
    },
  ]);
  await db
    .insert(invitations)
    .values({ inviteCode: "testinvite", createdUserId: "SYSTEM" });

  // --- 02.channel: チャンネル/メッセージ/ロール作成 ---
  await db.insert(channels).values([
    {
      id: "TESTCHANNEL1",
      name: "General",
      description: "General channel",
      createdUserId: "TESTUSER",
    },
    {
      id: "TESTCHANNEL2",
      name: "Random",
      description: "Random discussions",
      createdUserId: "TESTUSER",
    },
    {
      id: "TESTCHANNEL3",
      name: "Private Channel",
      description: "Private discussions",
      createdUserId: "TESTUSER",
    },
    {
      id: "TESTCHANNEL4",
      name: "Private Channel w/o users",
      description: "Private discussions",
      createdUserId: "SYSTEM",
    },
  ]);
  await db
    .insert(messages)
    .values({
      id: "TESTMESSAGE1",
      channelId: "TESTCHANNEL1",
      content: "Welcome to the General channel!",
      userId: "TESTUSER",
    })
    .onConflictDoNothing();
  await db
    .insert(messages)
    .values({
      id: "TESTMESSAGE2",
      channelId: "TESTCHANNEL2",
      content: "Feel free to chat here.",
      userId: "TESTUSER",
    })
    .onConflictDoNothing();
  await db
    .insert(messages)
    .values({
      id: "TESTMESSAGE3",
      channelId: "TESTCHANNEL3",
      content: "Secret message.",
      userId: "TESTUSER",
    })
    .onConflictDoNothing();
  await db.insert(channelJoins).values([
    { userId: "TESTUSER", channelId: "TESTCHANNEL1" },
    { userId: "TESTUSER2", channelId: "TESTCHANNEL2" },
  ]);
  await db.insert(roleInfos).values({
    id: "ChannelManage",
    name: "Channel Manage Role",
    createdUserId: "TESTUSER",
    manageChannel: true,
  });
  await db
    .insert(roleLinks)
    .values({ userId: "TESTUSER", roleId: "ChannelManage" });
  await db.insert(roleInfos).values({
    id: "ChannelPrivateViewer",
    name: "Channel Private Viewer Role",
    createdUserId: "TESTUSER",
  });
  await db
    .insert(roleLinks)
    .values({ userId: "TESTUSER", roleId: "ChannelPrivateViewer" });
  await db
    .insert(channelViewableRoles)
    .values({ channelId: "TESTCHANNEL3", roleId: "ChannelPrivateViewer" });
  // 無人のプライベートなチャンネル(TESTCHANNEL4)用
  await db.insert(roleInfos).values({
    id: "CompletePrivate",
    name: "Comple private role",
    createdUserId: "SYSTEM",
  });
  await db
    .insert(channelViewableRoles)
    .values({ channelId: "TESTCHANNEL4", roleId: "CompletePrivate" });

  // --- 03.role: ロール管理権限付与 ---
  await db.insert(roleInfos).values({
    id: "RoleManage",
    name: "Role Manage Role",
    createdUserId: "TESTUSER",
    manageRole: true,
  });
  await db
    .insert(roleLinks)
    .values({ roleId: "RoleManage", userId: "TESTUSER" });

  // --- 04.message: メッセージ関連データ追加 ---
  await db.delete(messageReadTimes);
  await db.delete(messageReactions);
  await db.delete(messageUrlPreviews);
  await db.delete(messages).where(eq(messages.channelId, "TESTCHANNEL1"));

  await db
    .insert(messages)
    .values({
      id: "TESTMESSAGE1",
      channelId: "TESTCHANNEL1",
      content: "Welcome to the General channel!",
      userId: "TESTUSER",
    })
    .onConflictDoNothing();
  await db
    .insert(messages)
    .values({
      id: "TESTMESSAGE2",
      channelId: "TESTCHANNEL1",
      content: "Feel free to chat here.",
      userId: "TESTUSER",
    })
    .onConflictDoNothing();

  await db
    .insert(inboxes)
    .values({ type: "message", messageId: "TESTMESSAGE1", userId: "TESTUSER" })
    .onConflictDoNothing();
  await db
    .insert(inboxes)
    .values({ type: "message", messageId: "TESTMESSAGE1", userId: "TESTUSER2" })
    .onConflictDoNothing();
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
