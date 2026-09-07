import { beforeAll, describe, expect, it, mock } from "bun:test";
import { FETCH, INIT } from "./util";

beforeAll(async () => {
  await INIT();
});

describe("GET /ext/message/:messageId", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/ext/message/TESTMESSAGE1",
      method: "GET",
      headers: { authorization: "TESTTOKEN1" }
    });
    const j = await res.json();
    expect(j.id).toBe("TESTMESSAGE1");
  });

  it("閲覧権限無しのボット", async () => {
    const res = await FETCH({
      path: "/ext/message/TESTMESSAGE1",
      method: "GET",
      headers: { authorization: "TESTTOKEN2" }
    });
    const t = await res.text();
    expect(t).toBe("Permission not enough");
  });
})
