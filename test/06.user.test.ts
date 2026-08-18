import { beforeAll, describe, expect, it } from "bun:test";
import { app, db } from "../src";
import { roleInfos, roleLinks } from "../src/db/schema";
import { FETCH, INIT } from "./util";

// sharpのresizeを通せる最小PNG(1x1px)
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
function pngFile(name = "icon.png") {
  return new File([Buffer.from(PNG_BASE64, "base64")], name, {
    type: "image/png",
  });
}

// change-password / profile-update / change-icon 等、副作用がありTESTUSERを汚したくないテスト専用ユーザー
let SUB_TOKEN = "";
let SUB_USER_ID = "";

// ban/unban テスト専用に使い捨てるユーザー
let BAN_TARGET_TOKEN = "";
let BAN_TARGET_USER_ID = "";

async function subFetch({
  path,
  method,
  body,
  isFormData = false,
  token = SUB_TOKEN,
}: {
  path: `/${string}`;
  method: "GET" | "POST" | "PUT" | "DELETE";
  // biome-ignore lint/suspicious/noExplicitAny: for test
  body?: any;
  isFormData?: boolean;
  token?: string;
}) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        Cookie: `token=${token}`,
      },
      body: isFormData ? body : JSON.stringify(body),
    }),
  );
}

async function signUpAndSignIn(username: string) {
  await app.handle(
    new Request("http://localhost/user/sign-up", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password: username,
        inviteCode: "testinvite",
      }),
    }),
  );
  const signInRes = await app.handle(
    new Request("http://localhost/user/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: username }),
    }),
  );
  const j = await signInRes.json();
  const token =
    signInRes.headers.get("set-cookie")?.match(/token=([^;]+)/)?.[1] ?? "";
  return { token, userId: j.data.userId as string };
}

beforeAll(async () => {
  await INIT();

  ({ token: SUB_TOKEN, userId: SUB_USER_ID } =
    await signUpAndSignIn("usertestsub"));
  ({ token: BAN_TARGET_TOKEN, userId: BAN_TARGET_USER_ID } =
    await signUpAndSignIn("usertestbantarget"));

  // ban/unban確認用にTESTUSERへ manageUser 権限ロールを付与
  await db.insert(roleInfos).values({
    id: "UserManage",
    name: "User Manage Role",
    createdUserId: "TESTUSER",
    manageUser: true,
  });
  await db
    .insert(roleLinks)
    .values({ roleId: "UserManage", userId: "TESTUSER" });
});

describe("/user/get-online", () => {
  it("正常", async () => {
    const res = await FETCH({ path: "/user/get-online", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data).toBeArray();
  });
});

describe("/user/list", () => {
  // cursorUserIdのテスト用
  let middleUserId = "";

  it("未認証 :: 401", async () => {
    const res = await FETCH({
      path: "/user/list",
      method: "GET",
      excludeCredential: true,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });

  it("正常", async () => {
    const res = await FETCH({ path: "/user/list", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBeGreaterThan(0);
    middleUserId = j.data[Math.floor(j.data.length / 2)].id;
  });

  it("正常 :: username検索", async () => {
    const res = await FETCH({
      path: "/user/list?username=testsystemuser",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBeGreaterThanOrEqual(2);
  });

  it("正常 :: joinedChannel検索", async () => {
    const res = await FETCH({
      path: "/user/list?joinedChannel=TESTCHANNEL1",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.some((u: { id: string }) => u.id === "TESTUSER")).toBe(true);
    expect(j.data.some((u: { id: string }) => u.id === "TESTUSER2")).toBe(
      false,
    );
  });

  it("正常 :: 複合検索", async () => {
    const res = await FETCH({
      path: "/user/list?joinedChannel=TESTCHANNEL2&username=testsys",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    // console.log("06.user.test :: /user/list : j", j);
    expect(j.data.some((u: { id: string }) => u.id === "TESTUSER2")).toBe(true);
    expect(j.data.some((u: { id: string }) => u.id === "TESTUSER1")).toBe(
      false,
    );
  });

  it("正常 :: 検索とlength指定の併用", async () => {
    const res = await FETCH({
      path: "/user/list?username=&length=1",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(1);
  });

  it("% injection 検索", async () => {
    const res = await FETCH({
      path: "/user/list?username=%user2",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(0);
  });

  it("_ injection 検索 :: ワイルドカードとして扱われない", async () => {
    const res = await FETCH({
      path: "/user/list?username=test_ystemuser",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    // _ が1文字のワイルドカードとして扱われるなら testsystemuser がヒットしてしまう
    expect(j.data.length).toBe(0);
  });

  it("前方一致のみ :: 後方一致ではヒットしない", async () => {
    const res = await FETCH({
      path: "/user/list?username=systemuser",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    // testsystemuser / testsystemuser2 はどちらも「systemuser」から始まらない
    expect(j.data.length).toBe(0);
  });

  it("username空文字 :: フィルタ無しと同覧", async () => {
    const resFiltered = await FETCH({
      path: "/user/list?username=",
      method: "GET",
    });
    const resAll = await FETCH({ path: "/user/list", method: "GET" });
    const jf = await resFiltered.json();
    const ja = await resAll.json();
    expect(resFiltered.ok).toBe(true);
    expect(jf.data.length).toBe(ja.data.length);
  });

  it("検索結果にもSYSTEMユーザーは含まれない", async () => {
    const res = await FETCH({
      path: "/user/list?username=",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.some((u: { id: string }) => u.id === "SYSTEM")).toBe(false);
  });

  it("正常 :: joinedChannel空文字 :: いずれかのチャンネル参加者のみヒット", async () => {
    const res = await FETCH({
      path: "/user/list?joinedChannel=",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    // TESTUSER(TESTCHANNEL1参加)・TESTUSER2(TESTCHANNEL2参加)はヒット
    expect(j.data.some((u: { id: string }) => u.id === "TESTUSER")).toBe(true);
    expect(j.data.some((u: { id: string }) => u.id === "TESTUSER2")).toBe(true);
    // どのチャンネルにも参加していないユーザー(usertestsub-renamed等)はヒットしない
    expect(j.data.some((u: { id: string }) => u.id === SUB_USER_ID)).toBe(
      false,
    );
    expect(
      j.data.some((u: { id: string }) => u.id === BAN_TARGET_USER_ID),
    ).toBe(false);
  });

  it("存在しないチャンネル指定 :: 200で空配列", async () => {
    const res = await FETCH({
      path: "/user/list?joinedChannel=NOTEXISTCHANNEL",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data).toBeArray();
    expect(j.data.length).toBe(0);
  });

  it("権限がないチャンネルで検索", async () => {
    const res = await FETCH({
      path: "/user/list?joinedChannel=TESTCHANNEL4",
      method: "GET",
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(t).toBe(
      "You can't search this channel due to visibility restrictions",
    );
  });

  it("権限がないチャンネルで検索 :: 他ユーザーでも同様に403", async () => {
    // TESTUSER2は ChannelPrivateViewer ロールを持たない
    const res = await FETCH({
      path: "/user/list?joinedChannel=TESTCHANNEL3",
      method: "GET",
      useSecondaryUser: true,
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    // TESTUSER2向けの文言検証は行わない(403であることだけ検証)
  });

  it("正常 :: 閲覧権限ロール所持者は非参加チャンネルも検索可", async () => {
    // TESTUSERは ChannelPrivateViewer ロールで TESTCHANNEL3 が閲覧可能
    const res = await FETCH({
      path: "/user/list?joinedChannel=TESTCHANNEL3",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    // TESTCHANNEL3 には誰も参加していないため空
    expect(j.data).toBeArray();
    expect(j.data.length).toBe(0);
  });

  it("正常 :: username検索とカーソルページネーションの併用", async () => {
    // ページネーション無しのフル結果を取得(username=testsystemuser は TESTUSER / TESTUSER2 の2件)
    const resFull = await FETCH({
      path: "/user/list?username=testsystemuser",
      method: "GET",
    });
    const jFull = await resFull.json();
    expect(resFull.ok).toBe(true);
    expect(jFull.data.length).toBe(2);

    // length=1 で1件ずつ取得し、連結してフル結果と一致することを検証
    const collected: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 2; i++) {
      const res = await FETCH({
        path: `/user/list?username=testsystemuser&length=1${
          cursor ? `&cursorUserId=${cursor}` : ""
        }`,
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      for (const u of j.data) {
        collected.push(u.id);
      }
      cursor = j.data.at(-1)?.id;
      if (j.data.length < 1) break;
    }

    // 重複なく・漏れなくフル結果と一致
    expect(collected.length).toBe(2);
    expect(new Set(collected).size).toBe(2);
    expect(collected).toEqual(jFull.data.map((u: { id: string }) => u.id));
  });

  it("正常 :: joinedChannel検索とカーソルページネーションの併用", async () => {
    // ページネーション無しのフル結果を取得
    const resFull = await FETCH({
      path: "/user/list?joinedChannel=TESTCHANNEL1",
      method: "GET",
    });
    const jFull = await resFull.json();
    expect(resFull.ok).toBe(true);
    expect(jFull.data.length).toBeGreaterThanOrEqual(1);
    const fullIds = jFull.data.map((u: { id: string }) => u.id);

    // length=1 でフル結果の件数+1ページまで取得し、連結して検証
    const collected: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i <= fullIds.length; i++) {
      const res = await FETCH({
        path: `/user/list?joinedChannel=TESTCHANNEL1&length=1${
          cursor ? `&cursorUserId=${cursor}` : ""
        }`,
        method: "GET",
      });
      const j = await res.json();
      expect(res.ok).toBe(true);
      for (const u of j.data) {
        collected.push(u.id);
      }
      cursor = j.data.at(-1)?.id;
      if (j.data.length < 1) break;
    }

    // 重複なく・漏れなくフル結果と一致
    expect(new Set(collected).size).toBe(collected.length);
    expect(collected).toEqual(fullIds);
  });

  it("SYSTEMユーザーは含まれない", async () => {
    const res = await FETCH({ path: "/user/list", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.some((u: { id: string }) => u.id === "SYSTEM")).toBe(false);
  });

  it("並び順 :: createdAt昇順・同一秒ならid昇順", async () => {
    const res = await FETCH({ path: "/user/list?length=50", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    for (let i = 0; i < j.data.length - 1; i++) {
      const cur = j.data[i];
      const next = j.data[i + 1];
      expect(
        cur.createdAt < next.createdAt ||
          (cur.createdAt === next.createdAt && cur.id < next.id),
      ).toBe(true);
    }
  });

  it("レスポンス構造 :: RoleLink を含む", async () => {
    const res = await FETCH({ path: "/user/list", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBeGreaterThan(0);
    for (const u of j.data) {
      expect(typeof u.id).toBe("string");
      expect(typeof u.name).toBe("string");
      expect(Array.isArray(u.RoleLink)).toBe(true);
      for (const link of u.RoleLink) {
        expect(typeof link.roleId).toBe("string");
      }
    }
  });

  it("正常 :: length指定", async () => {
    const res = await FETCH({ path: "/user/list?length=1", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(1);
  });

  it("length上限超過 :: 500(バリデーションエラー)", async () => {
    const res = await FETCH({ path: "/user/list?length=51", method: "GET" });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(t).toContain("somethin went wrong :(");
  });

  it("length下限未満 :: 500(バリデーションエラー)", async () => {
    const res = await FETCH({ path: "/user/list?length=0", method: "GET" });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(t).toContain("somethin went wrong :(");
  });

  it("正常 :: cursorUserId指定", async () => {
    const res = await FETCH({
      path: `/user/list?cursorUserId=${middleUserId}`,
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBeGreaterThanOrEqual(1);
  });

  it("存在しないcursorUserId", async () => {
    const res = await FETCH({
      path: "/user/list?cursorUserId=NOTEXIST",
      method: "GET",
    });
    expect(res.status).toBe(404);
  });

  it("cursorUserId=SYSTEM :: カーソルとして使用不可", async () => {
    const res = await FETCH({
      path: "/user/list?cursorUserId=SYSTEM",
      method: "GET",
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("cursorUserId空文字 :: 500(バリデーションエラー)", async () => {
    const res = await FETCH({
      path: "/user/list?cursorUserId=",
      method: "GET",
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(t).toContain("somethin went wrong :(");
  });
});

describe("/user/icon & /user/banner", () => {
  it("アイコン未設定 :: デフォルト画像が返る", async () => {
    const res = await FETCH({
      path: `/user/icon/${SUB_USER_ID}`,
      method: "GET",
    });
    expect(res.ok).toBe(true);
  });

  it("バナー未設定 :: 404", async () => {
    const res = await FETCH({
      path: `/user/banner/${SUB_USER_ID}`,
      method: "GET",
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(t).toBe("User banner not found");
  });
});

describe("/user/change-icon", () => {
  it("正常", async () => {
    const formData = new FormData();
    formData.append("icon", pngFile());
    const res = await subFetch({
      path: "/user/change-icon",
      method: "POST",
      body: formData,
      isFormData: true,
    });
    expect(res.ok).toBe(true);

    const iconRes = await FETCH({
      path: `/user/icon/${SUB_USER_ID}`,
      method: "GET",
    });
    expect(iconRes.ok).toBe(true);
  });

  it("不正なファイル形式", async () => {
    const formData = new FormData();
    formData.append(
      "icon",
      new File(["hello"], "test.txt", { type: "text/plain" }),
    );
    const res = await subFetch({
      path: "/user/change-icon",
      method: "POST",
      body: formData,
      isFormData: true,
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(t).toBe("File type is invalid");
  });
});

describe("/user/change-banner", () => {
  it("正常", async () => {
    const formData = new FormData();
    formData.append("banner", pngFile());
    const res = await subFetch({
      path: "/user/change-banner",
      method: "POST",
      body: formData,
      isFormData: true,
    });
    expect(res.ok).toBe(true);

    const bannerRes = await FETCH({
      path: `/user/banner/${SUB_USER_ID}`,
      method: "GET",
    });
    expect(bannerRes.ok).toBe(true);
  });

  it("不正なファイル形式", async () => {
    const formData = new FormData();
    formData.append(
      "banner",
      new File(["hello"], "test.txt", { type: "text/plain" }),
    );
    const res = await subFetch({
      path: "/user/change-banner",
      method: "POST",
      body: formData,
      isFormData: true,
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(t).toBe("File type is invalid");
  });
});

describe("/user/change-password", () => {
  it("現在のパスワードが間違っている", async () => {
    const res = await subFetch({
      path: "/user/change-password",
      method: "POST",
      body: { currentPassword: "wrongpassword", newPassword: "newpassword" },
    });
    const j = await res.json();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(j.message).toBe("Current password is incorrect");
  });

  it("正常", async () => {
    const res = await subFetch({
      path: "/user/change-password",
      method: "POST",
      body: { currentPassword: "usertestsub", newPassword: "usertestsubnew" },
    });
    expect(res.ok).toBe(true);

    // 新しいパスワードでサインインできることを確認
    const signInRes = await app.handle(
      new Request("http://localhost/user/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "usertestsub",
          password: "usertestsubnew",
        }),
      }),
    );
    expect(signInRes.ok).toBe(true);
  });

  it("パスワード変更で他セッションが無効化される", async () => {
    // 別セッションを用意（現在のパスワードで再サインイン）
    const secondSignInRes = await app.handle(
      new Request("http://localhost/user/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "usertestsub",
          password: "usertestsubnew",
        }),
      }),
    );
    const secondToken =
      secondSignInRes.headers.get("set-cookie")?.match(/token=([^;]+)/)?.[1] ??
      "";
    expect(secondToken).not.toBe("");

    // 別セッションが有効であることを事前確認
    const preVerify = await subFetch({
      path: "/user/verify-token",
      method: "GET",
      token: secondToken,
    });
    expect(preVerify.ok).toBe(true);

    // パスワード変更（SUB_TOKEN=現在のセッション）
    const res = await subFetch({
      path: "/user/change-password",
      method: "POST",
      body: {
        currentPassword: "usertestsubnew",
        newPassword: "usertestsubnew2",
      },
    });
    expect(res.ok).toBe(true);

    // 他セッション（secondToken）が無効化されていることを確認
    const postVerify = await subFetch({
      path: "/user/verify-token",
      method: "GET",
      token: secondToken,
    });
    expect(postVerify.ok).toBe(false);
    expect(postVerify.status).toBe(401);

    // 現在のセッション（SUB_TOKEN）は引き続き有効
    const currentVerify = await subFetch({
      path: "/user/verify-token",
      method: "GET",
      token: SUB_TOKEN,
    });
    expect(currentVerify.ok).toBe(true);
  });
});

describe("/user/profile-update", () => {
  it("正常", async () => {
    const res = await subFetch({
      path: "/user/profile-update",
      method: "POST",
      body: { name: "usertestsub-renamed", selfIntroduction: "自己紹介文" },
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.name).toBe("usertestsub-renamed");
    expect(j.data.selfIntroduction).toBe("自己紹介文");
  });

  it("nameが空欄", async () => {
    const res = await subFetch({
      path: "/user/profile-update",
      method: "POST",
      body: { name: "" },
    });
    expect(res.ok).toBe(false);
  });
});

describe("/user/info/:id", () => {
  it("正常 :: 自分", async () => {
    const res = await FETCH({ path: "/user/info/TESTUSER", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.id).toBe("TESTUSER");
    expect(j.data.ChannelJoin).toBeDefined();
  });

  it("正常 :: 他人", async () => {
    const res = await FETCH({ path: "/user/info/TESTUSER2", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.id).toBe("TESTUSER2");
    expect(j.data.ChannelJoin).toBeUndefined();
  });

  it("存在しないユーザー", async () => {
    const res = await FETCH({
      path: "/user/info/NOTEXISTUSER999",
      method: "GET",
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(t).toBe("User not found");
  });
});

describe("/user/ban & /user/unban", () => {
  it("自分自身をBANしようとする", async () => {
    const res = await FETCH({
      path: "/user/ban",
      method: "POST",
      body: { userId: "TESTUSER" },
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(t).toBe("You can't ban yourself");
  });

  it("HOSTをBANしようとする", async () => {
    const res = await FETCH({
      path: "/user/ban",
      method: "POST",
      body: { userId: "HOST" },
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(t).toBe("You can't ban HOST");
  });

  it("権限がない人によるBAN", async () => {
    const res = await FETCH({
      path: "/user/ban",
      method: "POST",
      body: { userId: BAN_TARGET_USER_ID },
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(t).toBe("Role level not enough");
  });

  it("正常 :: BANしてサインインできなくなることを確認", async () => {
    //BAN前に対象ユーザーのトークンでアクセスしてキャッシュに乗せておく
    //(BAN時のキャッシュ無効化が無いと最大5分間アクセスできてしまう)
    const preBanRes = await subFetch({
      path: "/user/verify-token",
      method: "GET",
      token: BAN_TARGET_TOKEN,
    });
    expect(preBanRes.ok).toBe(true);

    const res = await FETCH({
      path: "/user/ban",
      method: "POST",
      body: { userId: BAN_TARGET_USER_ID },
    });
    expect(res.ok).toBe(true);

    //BAN直後に対象ユーザーのトークンが即時無効化されていることを確認
    const postBanRes = await subFetch({
      path: "/user/verify-token",
      method: "GET",
      token: BAN_TARGET_TOKEN,
    });
    expect(postBanRes.ok).toBe(false);
    expect(postBanRes.status).toBe(401);

    const signInRes = await app.handle(
      new Request("http://localhost/user/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "usertestbantarget",
          password: "usertestbantarget",
        }),
      }),
    );
    const j = await signInRes.json();
    expect(signInRes.ok).toBe(false);
    expect(signInRes.status).toBe(401);
    expect(j.message).toBe("User is banned");
  });

  it("正常 :: UNBANしてサインインできるようになることを確認", async () => {
    const res = await FETCH({
      path: "/user/unban",
      method: "POST",
      body: { userId: BAN_TARGET_USER_ID },
    });
    expect(res.ok).toBe(true);

    const signInRes = await app.handle(
      new Request("http://localhost/user/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "usertestbantarget",
          password: "usertestbantarget",
        }),
      }),
    );
    expect(signInRes.ok).toBe(true);
  });

  it("正常 :: UNBAN直後に旧トークンが即時復活することを確認（BANキャッシュ無効化）", async () => {
    //BAN中に verify-token を行ったことで BAN_TARGET_TOKEN には isBanned: true のキャッシュが乗っている
    //UNBAN時のキャッシュ無効化が無いと最大5分間「User is banned」で弾かれてしまう
    const postUnbanRes = await subFetch({
      path: "/user/verify-token",
      method: "GET",
      token: BAN_TARGET_TOKEN,
    });
    expect(postUnbanRes.ok).toBe(true);
  });

  it("自分自身をUNBANしようとする", async () => {
    const res = await FETCH({
      path: "/user/unban",
      method: "POST",
      body: { userId: "TESTUSER" },
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(t).toBe("You can't unban yourself");
  });
});
