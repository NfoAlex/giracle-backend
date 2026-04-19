import { beforeAll, describe, expect, it } from "bun:test";
import { PrismaClient } from "../prisma/generated/client";
import { adapter, FETCH } from "./util";

beforeAll(async () => {
  const dbTest = new PrismaClient({ adapter });

  //ロール管理権限を付与
  await dbTest.roleInfo.create({
    data: {
      id: "RoleManage",
      name: "Role Manage Role",
      createdUserId: "TESTUSER",
      manageRole: true,
    },
  });
  await dbTest.roleLink.create({
    data: {
      roleId: "RoleManage",
      userId: "TESTUSER",
    },
  });
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

  it("nameが空欄", async () => {
    const res = await FETCH({
      path: "/role/search?name=",
      method: "GET",
    });
    expect(res.ok).toBe(false);
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

  it("権限ない人による更新", async () => {
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
      useSecondaryUser: true,
    });
    const t = await res.text();
    expect(t).toBe("Role level not enough");
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
  it("権限ない人によるリンク解除", async () => {
    const res = await FETCH({
      path: "/role/unlink",
      method: "POST",
      body: {
        userId: "TESTUSER2",
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

  it("存在しないユーザー", async () => {
    const res = await FETCH({
      path: "/role/unlink",
      method: "POST",
      body: {
        userId: "TESTUSER999",
        roleId: TEST__CREATED_ROLEID,
      },
    });
    const t = await res.text();
    expect(t).toBe("User not found");
    expect(res.ok).toBe(false);
  });

  it("存在しないロール", async () => {
    const res = await FETCH({
      path: "/role/unlink",
      method: "POST",
      body: {
        userId: "TESTUSER2",
        roleId: "TESTROLE999",
      },
    });
    const t = await res.text();
    expect(t).toBe("Role not linked to user");
    expect(res.ok).toBe(false);
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

  it("正常 :: 第２ユーザーとして", async () => {
    const res = await FETCH({
      path: "/role/RoleManage",
      method: "GET",
      useSecondaryUser: true,
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
    expect(j.data.length).toBe(5);
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
    expect(j.data.length).toBe(5);
  });
});
