import { beforeAll, describe, expect, it } from "bun:test";
import { NAME_MAX_LENGTH } from "../src";
import { FETCH, INIT } from "./util";

beforeAll(async () => {
  await INIT();
});

describe("/role/search", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/role/search?name=Channel Mana",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Role searched");
    expect(res.ok).toBe(true);
    expect(j.data.length).toBeGreaterThan(0);
    expect(j.data[0].manageChannel).toBeTrue();
  });

  it("存在しないロール", async () => {
    const res = await FETCH({
      path: "/role/search?name=9b34tkjsnldfnio",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Role searched");
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(0);
  });

  it("ワイルドカード文字(%)がリテラル扱いされる", async () => {
    //エスケープ無しだと%%%が全ロールにマッチしてしまう
    const res = await FETCH({
      path: "/role/search?name=%25",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(0);
  });

  it("ワイルドカード文字(_)がリテラル扱いされる", async () => {
    //エスケープ無しだと"Channel_Manage"が"Channel Manage Role"(下線=任意1文字)にマッチしてしまう
    const res = await FETCH({
      path: "/role/search?name=Channel_Manage",
      method: "GET",
    });
    const j = await res.json();
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(0);
  });
});

//作成したロールをのちのテストでも使うためにIDを保存する変数
let TEST__CREATED_ROLEID = "";
describe("/role/create", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/role/create",
      method: "PUT",
      body: {
        roleName: "new role",
        rolePower: {
          manageEmoji: true,
        },
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Role created");
    expect(res.ok).toBe(true);
    expect(j.data.name).toBe("new role");
    expect(j.data.manageEmoji).toBeTrue();
    TEST__CREATED_ROLEID = j.data.id;
  });

  it("今より強い権力を持つロールを作成", async () => {
    const res = await FETCH({
      path: "/role/create",
      method: "PUT",
      body: {
        roleName: "powerrr",
        rolePower: {
          manageServer: true,
        },
      },
    });
    const t = await res.text();
    expect(t).toBe("Role power is too powerful");
    expect(res.status).toBe(400);
    expect(res.ok).toBe(false);
  });

  it("roleNameが長すぎる", async () => {
    const res = await FETCH({
      path: "/role/create",
      method: "PUT",
      body: {
        roleName: "a".repeat(NAME_MAX_LENGTH + 1),
        rolePower: {},
      },
    });
    expect(res.ok).toBe(false);
  });

  it("名前被り", async () => {
    const res = await FETCH({
      path: "/role/create",
      method: "PUT",
      body: {
        roleName: "new role",
        rolePower: {
          manageEmoji: true,
        },
      },
    });
    const t = await res.text();
    expect(t).toBe("Role name already exists");
    expect(res.status).toBe(400);
    expect(res.ok).toBe(false);
  });

  it("権限ない人による作成", async () => {
    const res = await FETCH({
      path: "/role/create",
      method: "PUT",
      body: {
        roleName: "new role",
        rolePower: {
          manageEmoji: true,
        },
      },
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("Role level not enough");
    expect(res.ok).toBe(false);
  });
});

describe("/role/update", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/role/update",
      method: "POST",
      body: {
        roleId: TEST__CREATED_ROLEID,
        roleData: {
          name: "updated role",
          color: "#ff0000",
        },
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Role updated");
    expect(res.ok).toBe(true);
    expect(j.data.name).toBe("updated role");
    expect(j.data.color).toBe("#ff0000");
  });

  it("roleData.nameが長すぎる", async () => {
    const res = await FETCH({
      path: "/role/update",
      method: "POST",
      body: {
        roleId: TEST__CREATED_ROLEID,
        roleData: {
          name: "a".repeat(NAME_MAX_LENGTH + 1),
          color: "#ff0000",
        },
      },
    });
    expect(res.ok).toBe(false);
  });

  it("今の権力よりも強い権力を持つロールに更新", async () => {
    const res = await FETCH({
      path: "/role/update",
      method: "POST",
      body: {
        roleId: TEST__CREATED_ROLEID,
        roleData: {
          name: "updated role",
          color: "#ff0000",
          manageServer: true,
        },
      },
    });
    const t = await res.text();
    expect(t).toBe("Role power is too powerful");
    expect(res.status).toBe(400);
    expect(res.ok).toBe(false);
  });

  it("MEMBERの権限昇格", async () => {
    //MEMBERは全ユーザーが既定で持つため、MEMBERにmanageRoleを付けると全員が権限管理者になる
    const res = await FETCH({
      path: "/role/update",
      method: "POST",
      body: {
        roleId: "MEMBER",
        roleData: {
          name: "Member",
          color: "#ffffff",
          manageRole: true,
        },
      },
    });
    const t = await res.text();
    expect(t).toBe("Role power is too powerful");
    expect(res.status).toBe(400);
    expect(res.ok).toBe(false);
  });

  it("MEMBERの権限を下位のものに書き換える", async () => {
    const res = await FETCH({
      path: "/role/update",
      method: "POST",
      body: {
        roleId: "MEMBER",
        roleData: {
          name: "Renamed Member",
          color: "#00ff00",
          manageEmoji: true,
        },
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Role updated");
    expect(res.ok).toBe(true);
    expect(j.data.id).toBe("MEMBER");
    expect(j.data.name).toBe("Renamed Member");
    expect(j.data.manageEmoji).toBeTrue();

    //後続のテストへ影響しないよう元に戻す
    const revert = await FETCH({
      path: "/role/update",
      method: "POST",
      body: {
        roleId: "MEMBER",
        roleData: {
          name: "Member",
          color: "#000000",
          manageEmoji: false,
        },
      },
    });
    expect(revert.ok).toBe(true);
  });

  it("存在しないロール更新", async () => {
    const res = await FETCH({
      path: "/role/update",
      method: "POST",
      body: {
        roleId: "TESTROLE999",
        roleData: {
          name: "updated role",
          color: "#ff0000",
        },
      },
    });
    const t = await res.text();
    expect(t).toBe("Role level not enough or role not found");
    expect(res.ok).toBe(false);
  });
});

describe("/role/link", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/role/link",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        roleId: TEST__CREATED_ROLEID,
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Role linked");
    expect(res.ok).toBe(true);
  });

  it("再度リンク", async () => {
    const res = await FETCH({
      path: "/role/link",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        roleId: TEST__CREATED_ROLEID,
      },
    });
    const t = await res.text();
    expect(t).toBe("Role already linked");
    expect(res.ok).toBe(false);
  });

  it("存在しないユーザー", async () => {
    const res = await FETCH({
      path: "/role/link",
      method: "POST",
      body: {
        userId: "TESTUSER999",
        roleId: TEST__CREATED_ROLEID,
      },
    });
    const t = await res.text();
    expect(t).toBe("User not found");
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
  });

  it("Botロールはリンクできない", async () => {
    //作成時に自動でリンクされる専用ロールなので、後から付与させない
    const res = await FETCH({
      path: "/role/link",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        roleId: "BOT",
      },
    });
    const t = await res.text();
    expect(t).toBe("You cannot link default role");
    expect(res.status).toBe(400);
    expect(res.ok).toBe(false);
  });

  it("権限ない人によるリンク", async () => {
    const res = await FETCH({
      path: "/role/link",
      method: "POST",
      body: {
        userId: "TESTUSER1",
        roleId: TEST__CREATED_ROLEID,
      },
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("Role level not enough");
    expect(res.status).toBe(401);
    expect(res.ok).toBe(false);
  });
});

describe("/role/unlink", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/role/unlink",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        roleId: TEST__CREATED_ROLEID,
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Role unlinked");
    expect(res.ok).toBe(true);
  });

  it("存在しないユーザー・ロール", async () => {
    const resUser = await FETCH({
      path: "/role/unlink",
      method: "POST",
      body: {
        userId: "TESTUSER999",
        roleId: TEST__CREATED_ROLEID,
      },
    });
    const tUser = await resUser.text();
    expect(tUser).toBe("User not found");
    expect(resUser.ok).toBe(false);

    const resRole = await FETCH({
      path: "/role/unlink",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        roleId: "TESTROLE999",
      },
    });
    const tRole = await resRole.text();
    expect(tRole).toBe("Role not linked to user");
    expect(resRole.ok).toBe(false);
  });

  it("ついてないロールを外してみる", async () => {
    const res = await FETCH({
      path: "/role/unlink",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        roleId: TEST__CREATED_ROLEID,
      },
    });
    const t = await res.text();
    expect(t).toBe("Role not linked to user");
    expect(res.ok).toBe(false);
  });
});

describe("/role/delete", async () => {
  it("権限ない人による削除", async () => {
    const res = await FETCH({
      method: "DELETE",
      path: "/role/delete",
      body: {
        roleId: TEST__CREATED_ROLEID,
      },
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("Role level not enough");
    expect(res.ok).toBe(false);
  });

  it("正常", async () => {
    const res = await FETCH({
      method: "DELETE",
      path: "/role/delete",
      body: {
        roleId: TEST__CREATED_ROLEID,
      },
    });
    const j = await res.json();
    expect(j.message).toBe("Role deleted");
    expect(j.data).toBe(TEST__CREATED_ROLEID);
    expect(res.ok).toBe(true);
  });

  it("既定ロールMEMBERは削除できない", async () => {
    const res = await FETCH({
      method: "DELETE",
      path: "/role/delete",
      body: {
        roleId: "MEMBER",
      },
    });
    const t = await res.text();
    expect(t).toBe("You cannot delete default role");
    expect(res.status).toBe(400);
    expect(res.ok).toBe(false);
  });

  it("存在しないロール", async () => {
    const res = await FETCH({
      method: "DELETE",
      path: "/role/delete",
      body: {
        roleId: "TESTROLE999",
      },
    });
    const t = await res.text();
    expect(t).toBe("Role level not enough or role not found");
    expect(res.ok).toBe(false);
  });
});

describe("/role/:roleId", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/role/RoleManage",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Role info");
    expect(j.data.id).toBe("RoleManage");
    expect(j.data.manageRole).toBeTrue();
  });

  it("存在しないロール", async () => {
    const res = await FETCH({
      path: "/role/NoRoleHere999",
      method: "GET",
    });
    const t = await res.text();
    expect(t).toBe("Role not found");
    expect(res.ok).toBe(false);
  });
});

describe("/role/list", async () => {
  it("正常", async () => {
    const res = await FETCH({
      path: "/role/list",
      method: "GET",
    });
    const j = await res.json();
    expect(j.message).toBe("Role list");
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(7);
  });

  it("正常 :: 第２ユーザーとして", async () => {
    const res = await FETCH({
      path: "/role/list",
      method: "GET",
      useSecondaryUser: true,
    });
    const j = await res.json();
    expect(j.message).toBe("Role list");
    expect(res.ok).toBe(true);
    expect(j.data.length).toBe(7);
  });
});
