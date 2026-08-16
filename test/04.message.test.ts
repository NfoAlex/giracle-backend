import { beforeAll, describe, expect, it, mock } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src";
import { channelJoins, inboxes, messageFileAttached } from "../src/db/schema";
import { FETCH, INIT } from "./util";

// open-graph-scraperをモック化（外部リクエスト不要）
let lastOgsOptions:
  | { url?: string; fetchOptions?: { redirect?: string } }
  | undefined;
mock.module("open-graph-scraper", () => ({
  default: async (options: {
    url: string;
    fetchOptions?: { redirect?: string };
  }) => {
    lastOgsOptions = options;
    const { url } = options;
    if (url === "http://1.2.3.4") {
      return {
        error: false,
        result: {
          requestUrl: url,
          ogType: "website",
          ogTitle: "You should not see this",
          ogDescription: "Hidden Description",
          favicon: "https://example.com/favicon.ico",
          ogImage: [{ url: "https://example.com/image.png" }],
          ogVideo: undefined,
        },
      };
    }
    if (url === "https://fxtwitter.com/TEST/status/00000000") {
      return {
        error: false,
        result: {
          requestUrl: url,
          ogType: "website",
          ogTitle: "Test",
          ogDescription: "this is a tweet",
          favicon: "https://x.com/favicon.ico",
          ogImage: undefined,
          ogVideo: undefined,
        },
      };
    }
    if (url === "https://example.com/ogs-error") {
      return {
        error: true,
        result: undefined,
      };
    }

    return {
      error: false,
      result: {
        requestUrl: url,
        ogType: "website",
        ogTitle: "Mock OG Title",
        ogDescription: "Mock OG Description",
        favicon: "https://example.com/favicon.ico",
        ogImage: [{ url: "https://example.com/image.png" }],
        ogVideo: undefined,
      },
    };
  },
}));

beforeAll(async () => {
  await INIT();
});

describe("/message/:messageId", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/TESTMESSAGE1",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched message");
    expect(j.data.id).toBe("TESTMESSAGE1");
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCH({
      path: "/message/TESTMESSAGE999",
      method: "GET",
    });
    const t = await res.text();
    expect(t).toBe("Message not found");
    expect(res.status).toBe(404);
    expect(res.ok).toBeFalse();
  });

  it("見れないユーザーからの取得", async () => {
    const res = await FETCH({
      path: "/message/TESTMESSAGE3",
      method: "GET",
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("Message not found");
    expect(res.status).toBe(404);
    expect(res.ok).toBeFalse();
  });
});

//ここではまだ既読時間が無いため、すべて未読扱いになるはず
describe("/message/get-new :: 既読時間無し", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/get-new",
      method: "GET",
    });
    const j = await res.json();
    console.log("/message/get-new :: j->", j);
    expect(j.message).toBe("Fetched news");
    expect(j.data.TESTCHANNEL1).toBeFalse();
  });

  it("正常 :: 第２ユーザーとして", async () => {
    const res = await FETCH({
      path: "/message/get-new",
      method: "GET",
      useSecondaryUser: true,
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched news");
    expect(j.data.TESTCHANNEL2).toBeFalse();
  });
});

describe("/message/read-time/update", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/read-time/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        readTime: new Date("2000-01-01T00:00:00Z"),
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Updated read time");
    expect(j.data.channelId).toBe("TESTCHANNEL1");
  });

  it("さらに過去に設定してみる", async () => {
    const res = await FETCH({
      path: "/message/read-time/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        readTime: new Date("1999-01-01T00:00:00Z"),
      },
    });
    const t = await res.text();
    expect(t).toBe("Read time is already newer");
    expect(res.status).toBe(400);
    expect(res.ok).toBeFalse();
  });

  it("存在しないチャンネル", async () => {
    const res = await FETCH({
      path: "/message/read-time/update",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL999",
        readTime: new Date("2000-01-01T00:00:00Z"),
      },
    });
    const t = await res.text();
    expect(t).toBe("Channel not found");
    expect(res.status).toBe(404);
    expect(res.ok).toBeFalse();
  });
});

describe("/message/get-new :: 既読時間アリ", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/get-new",
      method: "GET",
    });
    const j = await res.json();
    console.log("/message/get-new :: j->", j);
    expect(j.message).toBe("Fetched news");
    expect(j.data.TESTCHANNEL1).toBeTrue();
  });

  it("正常 :: 第２ユーザーとして", async () => {
    const res = await FETCH({
      path: "/message/get-new",
      method: "GET",
      useSecondaryUser: true,
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched news");
    expect(j.data.TESTCHANNEL2).toBeFalse();
  });
});

describe("/message/search", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/search?content=free",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Searched messages");
    expect(j.data).toBeArray();
    expect(j.data.length).toBe(1);
  });

  it("正常 :: 全探索", async () => {
    const res = await FETCH({
      path: "/message/search",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Searched messages");
    expect(j.data).toBeArray();
    //他のテストにて参加チャンネルによる自動送信が含まれることがあるため
    expect(j.data.length).toBeGreaterThan(2);
  });

  it("正常 :: 単一チャンネル", async () => {
    const res = await FETCH({
      path: "/message/search?channelId=TESTCHANNEL1",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Searched messages");
    expect(j.data).toBeArray();
    expect(j.data.length).toBeGreaterThanOrEqual(1);
  });

  it("ワイルドカード文字(%)がリテラル扱いされる", async () => {
    //エスケープ無しだと%%%が全メッセージにマッチしてしまう
    const res = await FETCH({
      path: "/message/search?content=%25",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBeTrue();
    expect(j.data.length).toBe(0);
  });

  it("見れないユーザーからの検索", async () => {
    const res = await FETCH({
      path: "/message/search?channelId=TESTCHANNEL3",
      method: "GET",
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("You are not allowed to view this channel");
    expect(res.status).toBe(403);
    expect(res.ok).toBeFalse();
  });
});

describe("/message/file/upload", async () => {
  it("存在しないファイル", async () => {
    const res = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: {
        file: undefined,
      },
    });
    const t = await res.text();
    expect(t).toContain("somethin went wrong :(");
    expect(res.status).toBe(500);
    expect(res.ok).toBeFalse();
  });

  it("正常", async () => {
    const formData = new FormData();
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngBuffer = Buffer.from(pngBase64, "base64");
    formData.append("channelId", "TESTCHANNEL1");
    formData.append(
      "file",
      new File([pngBuffer], "test.png", { type: "image/png" }),
    );

    const res = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: formData,
    });
    const j = await res.json();
    expect(j.message).toBe("File uploaded");
    expect(j.data.fileId.id).toBeString();
  });

  it("正常 :: 不正なファイル名の正常パース", async () => {
    const formData = new FormData();
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngBuffer = Buffer.from(pngBase64, "base64");
    formData.append("channelId", "TESTCHANNEL1");
    formData.append(
      "file",
      new File([pngBuffer], "testあ/test_xss.png", { type: "image/png" }),
    );

    const res = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: formData,
    });
    const j = await res.json();
    expect(j.message).toBe("File uploaded");
    expect(j.data.fileId.id).toBeString();
    console.log("04.message :: /message/file/upload : ", { j });
  });

  it("未参加のチャンネルへアップロード", async () => {
    const formData = new FormData();
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngBuffer = Buffer.from(pngBase64, "base64");
    formData.append("channelId", "TESTCHANNEL1");
    formData.append(
      "file",
      new File([pngBuffer], "test.png", { type: "image/png" }),
    );

    const res = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: formData,
      useSecondaryUser: true,
    });
    expect(res.ok).toBeFalse();
  });

  it("危険なファイル種別(text/html)は拒否される(格納型XSS対策)", async () => {
    const formData = new FormData();
    formData.append("channelId", "TESTCHANNEL1");
    formData.append(
      "file",
      new File(["<script>alert(1)</script>"], "evil.html", {
        type: "text/html",
      }),
    );

    const res = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: formData,
    });
    const t = await res.text();
    expect(res.status).toBe(400);
    expect(t).toBe("File type is invalid");
  });

  it("ホワイトリスト内の非画像ファイルはアップロードできる", async () => {
    const formData = new FormData();
    formData.append("channelId", "TESTCHANNEL1");
    formData.append(
      "file",
      new File(["hello world"], "note.txt", { type: "text/plain" }),
    );

    const res = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: formData,
    });
    const j = await res.json();
    expect(j.message).toBe("File uploaded");
    expect(j.data.fileId.id).toBeString();
  });

  it("HTMLを画像(image/png)と偽装しても保存されない", async () => {
    const formData = new FormData();
    formData.append("channelId", "TESTCHANNEL1");
    formData.append(
      "file",
      new File(["<script>alert(1)</script>"], "evil.png", {
        type: "image/png",
      }),
    );

    const res = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: formData,
    });
    // sharp が画像として解釈できず、HTMLの生バイトは保存されず 400 で拒否される
    expect(res.ok).toBeFalse();
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("File type is invalid");
  });

  it("octet-stream で送られた .svg は拡張子から image/svg+xml に推論され WebP に再エンコードされる", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>`;
    const formData = new FormData();
    formData.append("channelId", "TESTCHANNEL1");
    formData.append(
      "file",
      new File([svg], "evil.svg", { type: "application/octet-stream" }),
    );

    const res = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: formData,
    });
    const j = await res.json();
    expect(j.message).toBe("File uploaded");
    const fileId = j.data.fileId.id;

    const getRes = await FETCH({
      path: `/message/file/${fileId}`,
      method: "GET",
    });
    // Bun の multipart パーサーが octet-stream をファイル名拡張子(.svg)から
    // image/svg+xml に推論するため、画像経路で WebP にラスタライズされる
    expect(getRes.headers.get("content-type")).toBe("image/webp");
  });

  it("SVG(image/svg+xml)はWebPに再エンコードされスクリプトが無効化される", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>`;
    const formData = new FormData();
    formData.append("channelId", "TESTCHANNEL1");
    formData.append(
      "file",
      new File([svg], "evil.svg", { type: "image/svg+xml" }),
    );

    const res = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: formData,
    });
    const j = await res.json();
    expect(j.message).toBe("File uploaded");
    const fileId = j.data.fileId.id;

    const getRes = await FETCH({
      path: `/message/file/${fileId}`,
      method: "GET",
    });
    // SVG として配信されず、WebP にラスタライズされる
    expect(getRes.headers.get("content-type")).toBe("image/webp");
  });

  it("HTMLをtext/plainと偽装しても実行可能な型で配信されない", async () => {
    const payload = "<script>alert(1)</script>";
    const formData = new FormData();
    formData.append("channelId", "TESTCHANNEL1");
    formData.append(
      "file",
      new File([payload], "evil.txt", { type: "text/plain" }),
    );

    const res = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: formData,
    });
    const j = await res.json();
    expect(j.message).toBe("File uploaded");
    const fileId = j.data.fileId.id;

    const getRes = await FETCH({
      path: `/message/file/${fileId}`,
      method: "GET",
    });
    // HTMLとして解釈されないこと、ダウンロード扱いになることを確認
    const contentType = getRes.headers.get("content-type");
    expect(contentType?.startsWith("text/plain")).toBe(true);
    expect(getRes.headers.get("content-disposition")).toBe("attachment");
    expect(getRes.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await getRes.text();
    expect(body).toBe(payload);
  });
});

describe("/message/file/get", async () => {
  let TEST_FILEID_FOR_GET = "";
  let TEST_FILEID_FOR_PRIVATE_CHANNEL = "";
  beforeAll(async () => {
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngBuffer = Buffer.from(pngBase64, "base64");

    let j = null;

    const formData1 = new FormData();
    formData1.append("channelId", "TESTCHANNEL1");
    formData1.append(
      "file",
      new File([pngBuffer], "test.png", { type: "image/png" }),
    );
    const res1 = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: formData1,
    });
    j = await res1.json();
    TEST_FILEID_FOR_GET = j.data.fileId.id;
    j = null;

    // TESTCHANNEL3はTESTUSERも参加していないためファイルアップロードするためにわざわざ参加
    await db.insert(channelJoins).values({
      userId: "TESTUSER",
      channelId: "TESTCHANNEL3",
    });
    const formData2 = new FormData();
    formData2.append("channelId", "TESTCHANNEL3"); //プライベートであるTESTCHANNEL3指定
    formData2.append(
      "file",
      new File([pngBuffer], "test.png", { type: "image/png" }),
    );
    const res2 = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: formData2,
    });
    j = await res2.json();
    TEST_FILEID_FOR_PRIVATE_CHANNEL = j.data.fileId.id;
    await db
      .delete(channelJoins)
      .where(
        and(
          eq(channelJoins.userId, "TESTUSER"),
          eq(channelJoins.channelId, "TESTCHANNEL3"),
        ),
      );
  });

  it("正常", async () => {
    const res = await FETCH({
      path: `/message/file/${TEST_FILEID_FOR_GET}`,
      method: "GET",
    });
    const buf = await res.arrayBuffer();
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(buf).toBeObject();
  });

  it("参加していなくても他チャンネルのファイルを見られる", async () => {
    const res = await FETCH({
      path: `/message/file/${TEST_FILEID_FOR_GET}`,
      method: "GET",
      useSecondaryUser: true,
    });
    expect(res.ok).toBeTrue();
  });

  it("プライベートチャンネルのファイルにアクセス", async () => {
    const res = await FETCH({
      path: `/message/file/${TEST_FILEID_FOR_PRIVATE_CHANNEL}`,
      method: "GET",
      useSecondaryUser: true,
    });
    expect(res.ok).toBeFalse();
  });
});

// /message/file/delete

describe("/message/inbox", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/inbox",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched inbox");
    expect(j.data).toBeArray();
    expect(j.data.length).toBe(1);
    expect(j.data[0].messageId).toBe("TESTMESSAGE1");
  });
});

describe("/message/inbox/read", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/inbox/read",
      method: "POST",
      body: {
        messageId: "TESTMESSAGE1",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Inbox read");
    expect(j.data).toBe("TESTMESSAGE1");
  });

  it("存在しないメッセージId", async () => {
    const res = await FETCH({
      path: "/message/inbox/read",
      method: "POST",
      body: {
        messageId: "TESTMESSAGE999",
      },
    });
    const t = await res.text();
    expect(t).toBe("Inbox not found");
  });
});

describe("/message/inbox/clear", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/inbox/clear",
      method: "POST",
      useSecondaryUser: true,
    });
    const j = await res.json();
    expect(j.message).toBe("Inbox cleared");
  });
});

describe("/message/emoji-reaction", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/emoji-reaction",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE1",
        emojiCode: "robot",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message reacted.");
    expect(j.data.emojiCode).toBe("robot");
  });

  it("見れないメッセージへのリアクション", async () => {
    const res = await FETCH({
      path: "/message/emoji-reaction",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL3",
        messageId: "TESTMESSAGE3",
        emojiCode: "robot",
      },
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("Message not found");
  });

  it("同じメッセに同じリアクション", async () => {
    const res = await FETCH({
      path: "/message/emoji-reaction",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE1",
        emojiCode: "robot",
      },
    });
    const t = await res.text();
    expect(t).toBe("You already reacted this message");
    expect(res.status).toBe(400);
    expect(res.ok).toBeFalse();
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCH({
      path: "/message/emoji-reaction",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE999",
        emojiCode: "robot",
      },
    });
    const t = await res.text();
    expect(t).toBe("Message not found");
    expect(res.status).toBe(404);
    expect(res.ok).toBeFalse();
  });
});

describe("/message/who-reacted", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/who-reacted?messageId=TESTMESSAGE1&emojiCode=robot",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched reactions");
    expect(j.data).toBeArray();
    expect(j.data.length).toBeGreaterThan(0);
    expect(j.data[0]).toBe("TESTUSER");
  });

  it("ついていないリアクション", async () => {
    const res = await FETCH({
      path: "/message/who-reacted?messageId=TESTMESSAGE1&emojiCode=smile",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched reactions");
    expect(j.data).toBeArray();
    expect(j.data.length).toBe(0);
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCH({
      path: "/message/who-reacted?messageId=TESTMESSAGE999&emojiCode=robot",
      method: "GET",
    });
    const t = await res.text();
    expect(t).toBe("Message not found or is private");
    expect(res.status).toBe(400);
    expect(res.ok).toBeFalse();
  });
});

describe("/message/delete-emoji-reaction", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/delete-emoji-reaction",
      method: "DELETE",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE1",
        emojiCode: "robot",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Reaction deleted");
    expect(j.data).toContainKey("channelId");
    expect(j.data).toContainKey("messageId");
    expect(j.data).toContainKey("emojiCode");
    expect(j.data.emojiCode).toBe("robot");
  });

  it("同じリアクションを消そうとしてみる（存在しない）", async () => {
    const res = await FETCH({
      path: "/message/delete-emoji-reaction",
      method: "DELETE",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE1",
        emojiCode: "robot",
      },
    });
    const t = await res.text();
    expect(t).toBe("Reaction does not exists");
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCH({
      path: "/message/delete-emoji-reaction",
      method: "DELETE",
      body: {
        channelId: "TESTCHANNEL1",
        messageId: "TESTMESSAGE999",
        emojiCode: "robot",
      },
    });
    const t = await res.text();
    expect(t).toBe("Message not found");
  });
});

let TEST__MESSAGE_ID = "";
describe("/message/send", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Hello, world!",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    expect(j.data).toContainKey("id");
    expect(j.data).toContainKey("channelId");
    expect(j.data).toContainKey("content");
    expect(j.data.content).toBe("Hello, world!");
    TEST__MESSAGE_ID = j.data.id;
  });

  it("存在しないメッセージへの返信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Hello, world!",
        replyingMessageId: "TESTMESSAGE999",
      },
    });
    const t = await res.text();
    expect(t).toBe("Replying message not found");
    expect(res.status).toBe(400);
    expect(res.ok).toBeFalse();
  });

  it("空白のみ送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "",
      },
    });
    const t = await res.text();
    expect(t).toBe("Message is empty");
    expect(res.status).toBe(400);
    expect(res.ok).toBeFalse();
  });

  it("同じユーザーに対し２回以上メンション", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "@<TESTUSER> @<TESTUSER> test",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    expect(res.status).toBe(200);

    const targetInbox = await db
      .select()
      .from(inboxes)
      .where(eq(inboxes.userId, "TESTUSER"));
    //上記テストで追加されたinbox1件だけになっているはず
    expect(targetInbox.length).toBe(1);
  });

  it("存在しないユーザーへのメンションはinboxに保存されない", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "@<GHOSTUSER999> hello",
      },
    });
    const j = await res.json();
    expect(res.ok).toBeTrue();
    expect(j.message).toBe("Message sent");

    //架空ユーザーのinboxデータが作られていないことを確認
    const ghostInbox = await db
      .select()
      .from(inboxes)
      .where(eq(inboxes.userId, "GHOSTUSER999"));
    expect(ghostInbox.length).toBe(0);
  });

  it("チャンネルに参加していないユーザーへのメンション", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "@<TESTUSER2> hello",
      },
    });
    const j = await res.json();
    expect(res.ok).toBeTrue();
    expect(j.message).toBe("Message sent");

    //第２ユーザーのInboxは上記の`/message/inbox/clear`で削除しているため0のはず
    const secondaryInbox = await db
      .select()
      .from(inboxes)
      .where(eq(inboxes.userId, "TESTUSER2"));
    expect(secondaryInbox.length).toBe(0);
  });

  let TEST__MESSAGE_ID_WITH_URL = "";
  it("正常 :: URL含むメッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out https://example.com",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    expect(j.data).toContainKey("id");
    TEST__MESSAGE_ID_WITH_URL = j.data.id;
  });
  it("正常 :: URL含むメッセージ送信 2/2 : 確認", async () => {
    // afterResponseは非同期で動くため少し待つ
    await Bun.sleep(500);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched message");
    expect(j.data.MessageUrlPreview).toBeArray();
    expect(j.data.MessageUrlPreview.length).toBeGreaterThan(0);
    expect(j.data.MessageUrlPreview[0].url).toBe("https://example.com");
    expect(j.data.MessageUrlPreview[0].title).toBe("Mock OG Title");
  });

  it("IPアドレスのURL含むメッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out http://1.2.3.4",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    expect(j.data).toContainKey("id");
    TEST__MESSAGE_ID_WITH_URL = j.data.id;
  });
  it("IPアドレスのURL含むメッセージ送信 2/2 : 確認", async () => {
    // afterResponseは非同期で動くため少し待つ
    await Bun.sleep(500);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched message");
    expect(j.data.MessageUrlPreview).toBeArray();
    expect(j.data.MessageUrlPreview.length).toBe(0);
  });

  it("localhostのURL含むメッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out http://localhost",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    expect(j.data).toContainKey("id");
    TEST__MESSAGE_ID_WITH_URL = j.data.id;
  });
  it("localhostのURL含むメッセージ送信 2/2 : 確認", async () => {
    // afterResponseは非同期で動くため少し待つ
    await Bun.sleep(500);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched message");
    expect(j.data.MessageUrlPreview).toBeArray();
    expect(j.data.MessageUrlPreview.length).toBe(0);
  });

  it("XのURL含むメッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out https://twitter.com/TEST/status/00000000",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    expect(j.data).toContainKey("id");
    TEST__MESSAGE_ID_WITH_URL = j.data.id;
  });
  it("IPアドレスのURL含むメッセージ送信 2/2 : 確認", async () => {
    // afterResponseは非同期で動くため少し待つ
    await Bun.sleep(500);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched message");
    expect(j.data.MessageUrlPreview).toBeArray();
    expect(j.data.MessageUrlPreview.length).toBe(1);
    expect(j.data.MessageUrlPreview[0].url).toBe(
      "https://fxtwitter.com/TEST/status/00000000",
    );
  });

  it("複数URL含むメッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "https://example.com https://example.org",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    TEST__MESSAGE_ID_WITH_URL = j.data.id;
  });
  it("複数URL含むメッセージ送信 2/2 : 確認", async () => {
    await Bun.sleep(500);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.data.MessageUrlPreview.length).toBe(2);
  });

  it("同一URL重複記載メッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "https://example.com https://example.com",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    TEST__MESSAGE_ID_WITH_URL = j.data.id;
  });
  it("同一URL重複記載メッセージ送信 2/2 : 確認（Setによりdedupeされ1件のみ）", async () => {
    await Bun.sleep(500);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.data.MessageUrlPreview.length).toBe(1);
    expect(j.data.MessageUrlPreview[0].url).toBe("https://example.com");
  });

  it("ポート付きIPアドレスのURL含むメッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out http://1.2.3.4:8080",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    TEST__MESSAGE_ID_WITH_URL = j.data.id;
  });
  it("ポート付きIPアドレスのURL含むメッセージ送信 2/2 : 確認", async () => {
    await Bun.sleep(500);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.data.MessageUrlPreview.length).toBe(0);
  });

  it("ポート付きlocalhostのURL含むメッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out http://localhost:3000",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    TEST__MESSAGE_ID_WITH_URL = j.data.id;
  });
  it("ポート付きlocalhostのURL含むメッセージ送信 2/2 : 確認", async () => {
    await Bun.sleep(500);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.data.MessageUrlPreview.length).toBe(0);
  });

  it("認証情報付きIPアドレスのURL含むメッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out http://user:pass@1.2.3.4",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    TEST__MESSAGE_ID_WITH_URL = j.data.id;
  });
  it("認証情報付きIPアドレスのURL含むメッセージ送信 2/2 : 確認", async () => {
    await Bun.sleep(500);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.data.MessageUrlPreview.length).toBe(0);
  });

  it("パブリックIPアドレスのURL含むメッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out http://8.8.8.8",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    TEST__MESSAGE_ID_WITH_URL = j.data.id;
  });
  it("パブリックIPアドレスのURL含むメッセージ送信 2/2 : 確認（プライベートIP以外も一律スキップされる仕様）", async () => {
    await Bun.sleep(500);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.data.MessageUrlPreview.length).toBe(0);
  });

  it("ogsがエラーを返すURL含むメッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out https://example.com/ogs-error",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    TEST__MESSAGE_ID_WITH_URL = j.data.id;
  });
  it("ogsがエラーを返すURL含むメッセージ送信 2/2 : 確認（プレビュー未挿入）", async () => {
    await Bun.sleep(500);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.data.MessageUrlPreview.length).toBe(0);
  });

  it("範囲外の数値によるIP風不正URL含むメッセージ送信（クラッシュしないことの確認）", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out http://999.999.999.999",
      },
    });
    expect(res.ok).toBeTrue();
    const j = await res.json();
    expect(j.message).toBe("Message sent");

    await Bun.sleep(500);

    const getRes = await FETCH({
      path: `/message/${j.data.id}`,
      method: "GET",
    });
    const getJ = await getRes.json();
    expect(getRes.ok).toBeTrue();
    expect(getJ.data.MessageUrlPreview.length).toBe(0);
  });

  // SSRF対策: IPv4の異表記がプレビュー対象にならないこと
  const ssrfBlockedUrls = [
    "http://2130706433/", // 10進表記 = 127.0.0.1
    "http://0177.0.0.1/", // 8進表記 = 127.0.0.1
    "http://0x7f.1/", // 16進表記 = 127.0.0.1
    "http://127.1/", // 短縮表記 = 127.0.0.1
  ];
  for (const blockedUrl of ssrfBlockedUrls) {
    it(`SSRF対策 :: ${blockedUrl} はプレビュー取得されない`, async () => {
      const res = await FETCH({
        path: "/message/send",
        method: "POST",
        body: {
          channelId: "TESTCHANNEL1",
          message: `Check this out ${blockedUrl}`,
        },
      });
      expect(res.ok).toBeTrue();
      const j = await res.json();
      expect(j.message).toBe("Message sent");

      await Bun.sleep(500);

      const getRes = await FETCH({
        path: `/message/${j.data.id}`,
        method: "GET",
      });
      const getJ = await getRes.json();
      expect(getRes.ok).toBeTrue();
      expect(getJ.data.MessageUrlPreview.length).toBe(0);
    });
  }

  it("SSRF対策 :: OGP取得時にリダイレクト追従が無効化されている", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out https://example.com",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");

    await Bun.sleep(500);

    expect(lastOgsOptions?.fetchOptions?.redirect).toBe("manual");
  });

  it("IPv6リテラルURL含むメッセージ送信（URL正規表現が非対応のため未検出で通過確認）", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "Check this out http://[::1]/test",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");

    await Bun.sleep(500);

    const getRes = await FETCH({
      path: `/message/${j.data.id}`,
      method: "GET",
    });
    const getJ = await getRes.json();
    expect(getJ.data.MessageUrlPreview.length).toBe(0);
  });

  it("Twitter・IP・通常URL混在メッセージ送信 1/2 : 送信", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message:
          "https://twitter.com/TEST/status/00000000 http://1.2.3.4 https://example.com",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message sent");
    TEST__MESSAGE_ID_WITH_URL = j.data.id;
  });
  it("Twitter・IP・通常URL混在メッセージ送信 2/2 : 確認（IPのみ除外・Twitterはfxtwitter変換）", async () => {
    await Bun.sleep(500);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID_WITH_URL}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.data.MessageUrlPreview.length).toBe(2);
    const urls = j.data.MessageUrlPreview.map((p: { url: string }) => p.url);
    expect(urls).toContain("https://fxtwitter.com/TEST/status/00000000");
    expect(urls).toContain("https://example.com");
  });
});

describe("/message/send :: fileIds検証", async () => {
  //自分でアップロードした未添付ファイルのId(正常系用)
  let TEST_FILEID_OWN = "";
  beforeAll(async () => {
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngBuffer = Buffer.from(pngBase64, "base64");
    const formData = new FormData();
    formData.append("channelId", "TESTCHANNEL1");
    formData.append(
      "file",
      new File([pngBuffer], "attach-test.png", { type: "image/png" }),
    );
    const res = await FETCH({
      path: "/message/file/upload",
      method: "POST",
      body: formData,
    });
    const j = await res.json();
    TEST_FILEID_OWN = j.data.fileId.id;
  });

  it("存在しないfileIdを添付", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "file test",
        fileIds: ["FILE_NOT_EXIST"],
      },
    });
    const t = await res.text();
    expect(res.ok).toBeFalse();
    expect(res.status).toBe(400);
    expect(t).toBe("Attached file not found");
  });

  it("他ユーザーがアップロードしたファイルを添付", async () => {
    //TESTUSER2名義のファイル情報を直接作成
    const [foreignFile] = await db
      .insert(messageFileAttached)
      .values({
        channelId: "TESTCHANNEL1",
        userId: "TESTUSER2",
        actualFileName: "foreign.png",
        savedFileName: "foreign.png",
        size: 1,
        type: "image/png",
      })
      .returning();

    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "file test",
        fileIds: [foreignFile.id],
      },
    });
    const t = await res.text();
    expect(res.ok).toBeFalse();
    expect(res.status).toBe(400);
    expect(t).toBe("Invalid file attachment");
  });

  it("既に他メッセージへ添付済みのファイルを添付", async () => {
    //添付済み(messageId設定済み)のファイル情報を直接作成
    const [attachedFile] = await db
      .insert(messageFileAttached)
      .values({
        channelId: "TESTCHANNEL1",
        userId: "TESTUSER",
        actualFileName: "attached.png",
        savedFileName: "attached.png",
        size: 1,
        type: "image/png",
        messageId: "TESTMESSAGE1",
      })
      .returning();

    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "file test",
        fileIds: [attachedFile.id],
      },
    });
    const t = await res.text();
    expect(res.ok).toBeFalse();
    expect(res.status).toBe(400);
    expect(t).toBe("Invalid file attachment");
  });

  it("正常 :: 自分の未添付ファイルを添付", async () => {
    const res = await FETCH({
      path: "/message/send",
      method: "POST",
      body: {
        channelId: "TESTCHANNEL1",
        message: "file attach ok",
        fileIds: [TEST_FILEID_OWN],
      },
    });
    const j = await res.json();
    expect(res.ok).toBeTrue();
    expect(j.message).toBe("Message sent");
    expect(j.data.MessageFileAttached).toBeArray();
    expect(j.data.MessageFileAttached[0].id).toBe(TEST_FILEID_OWN);
  });
});

describe("/message/edit", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/message/edit",
      method: "POST",
      body: {
        messageId: TEST__MESSAGE_ID,
        channelId: "TESTCHANNEL1",
        message: "Hello, world! (edited)",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message edited");
    expect(j.data).toContainKey("id");
    expect(j.data).toContainKey("channelId");
    expect(j.data).toContainKey("content");
    expect(j.data.content).toBe("Hello, world! (edited)");
    expect(j.data.isEdited).toBeTrue();
  });

  it("正常 :: URLを含めた編集 1/2", async () => {
    const res = await FETCH({
      path: "/message/edit",
      method: "POST",
      body: {
        messageId: TEST__MESSAGE_ID,
        channelId: "TESTCHANNEL1",
        message: "Hello, world! https://example.com (edited with link)",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message edited");
    expect(j.data).toContainKey("id");
    expect(j.data).toContainKey("channelId");
    expect(j.data).toContainKey("content");
    expect(j.data.content).toBe(
      "Hello, world! https://example.com (edited with link)",
    );
    expect(j.data.isEdited).toBeTrue();
  });

  it("正常 :: URLを含めた編集 2/2 : 確認", async () => {
    // afterResponseは非同期で動くため少し待つ
    await Bun.sleep(1000);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Fetched message");
    expect(j.data.MessageUrlPreview).toBeArray();
    expect(j.data.MessageUrlPreview.length).toBeGreaterThan(0);
    expect(j.data.MessageUrlPreview[0].url).toBe("https://example.com");
    expect(j.data.MessageUrlPreview[0].title).toBe("Mock OG Title");
  });

  it("URLを含む編集からURLなし編集への変更 1/2 : 編集", async () => {
    const res = await FETCH({
      path: "/message/edit",
      method: "POST",
      body: {
        messageId: TEST__MESSAGE_ID,
        channelId: "TESTCHANNEL1",
        message: "Hello, world! (no link anymore)",
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Message edited");
    expect(j.data.content).toBe("Hello, world! (no link anymore)");
  });

  it("URLを含む編集からURLなし編集への変更 2/2 : 確認（既存プレビュー削除）", async () => {
    await Bun.sleep(1000);

    const res = await FETCH({
      path: `/message/${TEST__MESSAGE_ID}`,
      method: "GET",
    });
    const j = await res.json();
    expect(j.data.MessageUrlPreview).toBeArray();
    expect(j.data.MessageUrlPreview.length).toBe(0);
  });

  it("空白にしてみる", async () => {
    const res = await FETCH({
      path: "/message/edit",
      method: "POST",
      body: {
        messageId: TEST__MESSAGE_ID,
        channelId: "TESTCHANNEL1",
        message: "",
      },
    });
    expect(res.status).toBe(500);
    expect(res.ok).toBeFalse();
  });

  it("存在しないメッセージ", async () => {
    const res = await FETCH({
      path: "/message/edit",
      method: "POST",
      body: {
        messageId: "TESTMESSAGE999",
        channelId: "TESTCHANNEL1",
        message: "Try to edit non-existent message",
      },
    });
    const t = await res.text();
    expect(t).toBe("Message not found");
    expect(res.status).toBe(404);
    expect(res.ok).toBeFalse();
  });
});
