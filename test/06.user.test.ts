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

describe("/user/search", () => {
  it("正常 :: username検索", async () => {
    const res = await FETCH({
      path: "/user/search?username=testsystemuser",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBeGreaterThanOrEqual(2);
  });

  it("正常 :: joinedChannel検索", async () => {
    const res = await FETCH({
      path: "/user/search?joinedChannel=TESTCHANNEL1",
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
      path: "/user/search?joinedChannel=TESTCHANNEL2&username=testsys",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    // console.log("06.user.test :: /user/search : j", j);
    expect(j.data.some((u: { id: string }) => u.id === "TESTUSER2")).toBe(true);
    expect(j.data.some((u: { id: string }) => u.id === "TESTUSER1")).toBe(
      false,
    );
  });

  it("% injection 検索", async () => {
    const res = await FETCH({
      path: "/user/search?username=%user2",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(0);
  });

  it("権限がないチャンネルで検索", async () => {
    const res = await FETCH({
      path: "/user/search?joinedChannel=TESTCHANNEL4",
      method: "GET",
    });
    const t = await res.text();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(t).toBe(
      "You can't search this channel due to visibility restrictions",
    );
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
  it("正常", async () => {
    const res = await FETCH({ path: "/user/info/TESTUSER", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.id).toBe("TESTUSER");
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

describe("/user/list", () => {
  it("正常", async () => {
    const res = await FETCH({ path: "/user/list", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBeGreaterThan(0);
  });

  it("正常 :: length指定", async () => {
    const res = await FETCH({ path: "/user/list?length=1", method: "GET" });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(1);
  });

  // it("正常 :: cursorUserId指定", async () => {
  //   const res = await FETCH({
  //     path: "/user/list?cursorUserId=TESTUSER",
  //     method: "GET",
  //   });
  //   const j = await res.json();
  //   console.log("06.user :: /user/list cursorUserId指定 : j", j);
  //   expect(res.ok).toBe(true);
  //   expect(j.data.length).toBeGreaterThanOrEqual(1);
  //   expect(j.data[0].id).toBe("TESTUSER2");
  // });
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
