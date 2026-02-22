import { beforeAll, describe, expect, it } from "bun:test";

import { execSync } from "node:child_process";
import { PrismaClient } from "../prisma/generated/client";
import { app } from "../src";
import { adapter, FETCH } from "./util";

beforeAll(async () => {
  const dbTest = new PrismaClient({ adapter });
  //DBのマイグレーション
  execSync("bunx prisma db push --accept-data-loss");

  //Prismaでuserデータにかかわるものをすべて削除
  await dbTest.token.deleteMany({});
  await dbTest.password.deleteMany({});
  await dbTest.channelViewableRole.deleteMany({});
  await dbTest.channelJoin.deleteMany({});
  await dbTest.inbox.deleteMany({});
  await dbTest.messageReadTime.deleteMany({});
  await dbTest.messageReaction.deleteMany({});
  await dbTest.message.deleteMany({});
  await dbTest.roleLink.deleteMany({});
  await dbTest.roleInfo.deleteMany({});
  await dbTest.channel.deleteMany({});
  await dbTest.invitation.deleteMany({});
  await dbTest.user.deleteMany({});
  await dbTest.serverConfig.deleteMany({});

  //DBの初期シード挿入
  execSync("bun ./prisma/seeds.ts");
  //テストユーザー用データ登録
  await dbTest.user.createMany({
    data: [
      {
        id: "TESTUSER",
        name: "testsystemuser",
        selfIntroduction: "",
      },
      {
        id: "TESTUSER2",
        name: "testsystemuser2",
        selfIntroduction: "",
      },
    ],
  });
  await dbTest.token.createMany({
    data: [
      {
        userId: "TESTUSER",
        token: "TESTUSERTOKEN",
      },
      {
        userId: "TESTUSER",
        token: "TESTUSERTOKEN_FOR_SIGNOUT_TEST",
      },
      {
        userId: "TESTUSER2",
        token: "TESTUSER2TOKEN",
      },
    ],
  });
  //テスト用の招待コードをここで作成しておく
  await dbTest.invitation.create({
    data: {
      inviteCode: "testinvite",
      createdUserId: "SYSTEM",
    },
  });
});

describe("/user", () => {
  it("/sign-up :: パスワード無し", async () => {
    const res = await FETCH({
      path: "/user/sign-up",
      method: "PUT",
      body: { username: "erroruser", password: "" },
      excludeCredential: true,
    });

    expect(res.ok).toBe(false);
  });

  it("/sign-up :: 招待コード無し", async () => {
    const res = await FETCH({
      path: "/user/sign-up",
      method: "PUT",
      body: {
        username: "erroruser",
        password: "testuser",
      },
      excludeCredential: true,
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  it("/sign-up :: 正常", async () => {
    const res = await FETCH({
      path: "/user/sign-up",
      method: "PUT",
      body: {
        username: "testuser",
        password: "testuser",
        inviteCode: "testinvite",
      },
      excludeCredential: true,
    });

    expect(res.ok).toBe(true);
  });

  it("/sign-in :: 正常", async () => {
    const res = await FETCH({
      path: "/user/sign-in",
      method: "POST",
      body: {
        username: "testuser",
        password: "testuser",
      },
      excludeCredential: true,
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.userId).toBeDefined();
  });

  it("/sign-in :: パスワード無し", async () => {
    const res = await FETCH({
      path: "/user/sign-in",
      method: "POST",
      body: {
        username: "testuser",
        password: "",
      },
    });
    expect(res.ok).toBe(false);
  });

  it("/verify-token :: クレデンシャル無し", async () => {
    const res = await FETCH({
      path: "/user/verify-token",
      method: "GET",
      excludeCredential: true,
    });
    expect(res.ok).toBe(false);
  });

  it("/verify-token :: 正常", async () => {
    const response = await app.handle(
      new Request("http://localhost/user/verify-token", {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: "token=TESTUSERTOKEN",
        },
      }),
    );
    const j = await response.json();
    expect(response.ok).toBe(true);
    expect(j.data.userId).toBe("TESTUSER");
  });

  let sessionIdRemoving = -1;
  it("/session :: セッションを取得する", async () => {
    const response = await app.handle(
      new Request("http://localhost/user/session", {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: "token=TESTUSERTOKEN",
        },
      }),
    );
    const j = await response.json();
    expect(response.ok).toBe(true);
    expect(j.data).toBeArray();
    expect(j.data[0].userId).toBe("TESTUSER");
    expect(j.data[0].thisIsYou).toBeTrue();
    sessionIdRemoving = j.data[0].id;
  });

  it("/sign-out :: 正常(ログアウトしてセッションが消えていることを確認する)", async () => {
    const response = await app.handle(
      new Request("http://localhost/user/sign-out", {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: "token=TESTUSERTOKEN_FOR_SIGNOUT_TEST",
        },
      }),
    );
    const j = await response.json();
    expect(response.ok).toBe(true);
    expect(j.message).toBe("Signed out");
  });

  it("DELETE /session :: 存在しないセッションを削除する", async () => {
    const response = await app.handle(
      new Request("http://localhost/user/session", {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: `token=TESTUSERTOKEN`,
        },
        body: JSON.stringify({
          sessionId: 999999, //存在しないセッションID
        })
      }),
    );
    const t = await response.text();
    console.log("01.auth :: DELETE /session : 存在しないセッションを削除する", t);
    expect(t).toContain("Session not found");
  });

  it("DELETE /session :: 正常(セッションを削除する)", async () => {
    const response = await app.handle(
      new Request("http://localhost/user/session", {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: `token=TESTUSERTOKEN`,
        },
        body: JSON.stringify({
          sessionId: sessionIdRemoving,
        })
      }),
    );
    const j = await response.json();
    expect(response.ok).toBe(true);
    expect(j.message).toBe("Session removed");
    expect(j.data.sessionId).toBe(sessionIdRemoving);
  });
});
