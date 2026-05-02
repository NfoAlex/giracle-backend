import { beforeAll, describe, expect, it } from "bun:test";

import { app } from "../src";
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
          name: "新しいセッション名"
        })
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
          name: ""
        })
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
          name: "新しいセッション名2"
        })
      }),
    );
    expect(responseChangingName.ok).toBe(false);
    const t = await responseChangingName.text();
    expect(t).toBe("Session not found");
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
        })
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
        })
      }),
    );
    const j = await response.json();
    expect(response.ok).toBe(true);
    expect(j.message).toBe("Session removed");
    expect(j.data.sessionId).toBe(sessionIdRemoving);
  });
});
