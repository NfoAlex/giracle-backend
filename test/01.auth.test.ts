import { beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app, db } from "../src";
import { invitations } from "../src/db/schema";
import { FETCH, INIT } from "./util";

beforeAll(async () => {
  await INIT();
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

  describe("/sign-up :: 招待コード上限", () => {
    it("usedCountがmaxUsageに達していると登録できない", async () => {
      await db.insert(invitations).values({
        inviteCode: "invitefull",
        createdUserId: "SYSTEM",
        usedCount: 2,
        maxUsage: 2,
      });

      const res = await FETCH({
        path: "/user/sign-up",
        method: "PUT",
        body: {
          username: "invitefulluser",
          password: "testpass",
          inviteCode: "invitefull",
        },
        excludeCredential: true,
      });
      const j = await res.json();
      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);
      expect(j.message).toBe("Invite code reached maximum limit");
    });

    it("最後の1回を消費した後は登録できない", async () => {
      await db.insert(invitations).values({
        inviteCode: "invitelast",
        createdUserId: "SYSTEM",
        usedCount: 0,
        maxUsage: 1,
      });

      // 1回目(最後の1回): 成功
      const res1 = await FETCH({
        path: "/user/sign-up",
        method: "PUT",
        body: {
          username: "invitelastuser",
          password: "testpass",
          inviteCode: "invitelast",
        },
        excludeCredential: true,
      });
      expect(res1.ok).toBe(true);

      // 2回目: 上限到達で失敗
      const res2 = await FETCH({
        path: "/user/sign-up",
        method: "PUT",
        body: {
          username: "invitelastuser2",
          password: "testpass",
          inviteCode: "invitelast",
        },
        excludeCredential: true,
      });
      const j2 = await res2.json();
      expect(res2.ok).toBe(false);
      expect(res2.status).toBe(400);
      expect(j2.message).toBe("Invite code reached maximum limit");
    });

    it("maxUsage=-1は上限なしで複数回登録できる", async () => {
      await db.insert(invitations).values({
        inviteCode: "inviteunlimited",
        createdUserId: "SYSTEM",
        usedCount: 0,
        maxUsage: -1,
      });

      for (let i = 1; i <= 3; i++) {
        const res = await FETCH({
          path: "/user/sign-up",
          method: "PUT",
          body: {
            username: `inviteunlimiteduser${i}`,
            password: "testpass",
            inviteCode: "inviteunlimited",
          },
          excludeCredential: true,
        });
        expect(res.ok).toBe(true);
      }

      // -1の場合も上限チェックを迂回せず、使用回数は正常に加算される
      const invite = await db.query.invitations.findFirst({
        where: eq(invitations.inviteCode, "inviteunlimited"),
      });
      expect(invite?.usedCount).toBe(3);
    });
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

  it("/verify-token :: 期限切れトークンは無効", async () => {
    const response = await app.handle(
      new Request("http://localhost/user/verify-token", {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: "token=TESTUSER2TOKEN_EXPIRED",
        },
      }),
    );
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });

  let sessionIdRemoving = -1;
  it("/session :: セッションを取得する", async () => {
    const response = await app.handle(
      new Request("http://localhost/user/session", {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: "token=TESTUSERTOKEN_FOR_DELETION_TEST",
        },
      }),
    );
    const j = await response.json();
    expect(response.ok).toBe(true);
    expect(j.data).toBeArray();
    expect(j.data[0].userId).toBe("TESTUSER");
    //2番目のトークンがTESTUSERTOKEN_FOR_DELETION_TEST
    expect(j.data[2].thisIsYou).toBeTrue();
    sessionIdRemoving = j.data[2].id;
  });

  it("/change-session-name :: 正常(セッション名を変更)", async () => {
    const responseChangingName = await app.handle(
      new Request("http://localhost/user/change-session-name", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: "token=TESTUSERTOKEN_FOR_DELETION_TEST",
        },
        body: JSON.stringify({
          sessionId: sessionIdRemoving,
          name: "新しいセッション名",
        }),
      }),
    );
    expect(responseChangingName.ok).toBe(true);
    const j = await responseChangingName.json();
    console.log("01.auth :: /change-session-name : j", j);
    expect(j.data.name).toBe("新しいセッション名");
  });

  it("/change-session-name :: 変更しようとしているセッション名が空", async () => {
    const responseChangingName = await app.handle(
      new Request("http://localhost/user/change-session-name", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: "token=TESTUSERTOKEN_FOR_DELETION_TEST",
        },
        body: JSON.stringify({
          sessionId: sessionIdRemoving,
          name: "",
        }),
      }),
    );
    expect(responseChangingName.ok).toBe(false);
  });

  it("/change-session-name :: 存在しないセッション", async () => {
    const responseChangingName = await app.handle(
      new Request("http://localhost/user/change-session-name", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: "token=TESTUSERTOKEN_FOR_DELETION_TEST",
        },
        body: JSON.stringify({
          sessionId: 999999,
          name: "新しいセッション名2",
        }),
      }),
    );
    expect(responseChangingName.ok).toBe(false);
    const t = await responseChangingName.text();
    expect(t).toBe("Session not found");
  });

  it("/sign-out :: 正常(ログアウトしてセッションが消えていることを確認する)", async () => {
    const response = await app.handle(
      new Request("http://localhost/user/sign-out", {
        method: "POST",
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

  it("/sign-out :: サインアウト済みトークンが即時無効になっている(トークンキャッシュ無効化)", async () => {
    //直前のサインアウトリクエストでトークンがキャッシュに乗っているため、
    //キャッシュ無効化が無いと最大5分間このトークンが有効なままになる
    const response = await app.handle(
      new Request("http://localhost/user/verify-token", {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: "token=TESTUSERTOKEN_FOR_SIGNOUT_TEST",
        },
      }),
    );
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
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
        }),
      }),
    );
    const t = await response.text();
    expect(t).toContain("Session not found");
  });

  it("DELETE /session :: 自分のセッションを削除しようとしてみる", async () => {
    const response = await app.handle(
      new Request("http://localhost/user/session", {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: `token=TESTUSERTOKEN_FOR_DELETION_TEST`,
        },
        body: JSON.stringify({
          sessionId: sessionIdRemoving,
        }),
      }),
    );
    const t = await response.text();
    expect(t).toBe("You cannot delete your active session");
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
        }),
      }),
    );
    const j = await response.json();
    expect(response.ok).toBe(true);
    expect(j.message).toBe("Session removed");
    expect(j.data.sessionId).toBe(sessionIdRemoving);
  });

  it("DELETE /session :: 削除済みセッションのトークンが即時無効になっている(トークンキャッシュ無効化)", async () => {
    //TESTUSERTOKEN_FOR_DELETION_TESTは先のテストでキャッシュに乗っているため、
    //キャッシュ無効化が無いと最大5分間このトークンが有効なままになる
    const response = await app.handle(
      new Request("http://localhost/user/verify-token", {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Cookie: "token=TESTUSERTOKEN_FOR_DELETION_TEST",
        },
      }),
    );
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });
});
