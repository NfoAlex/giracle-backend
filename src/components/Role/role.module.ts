import Elysia, { status, t } from "elysia";
import { Middleware } from "../../Middlewares";
import { ServiceRole } from "./role.service";

export const role = new Elysia({ prefix: "/role" })
  .use(Middleware.CheckToken)
  .get(
    "/search",
    async ({ query: { name } }) => {
      const roles = await ServiceRole.Search(name);

      return {
        message: "Role searched",
        data: roles,
      };
    },
    {
      query: t.Object({
        name: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "ロールを検索します",
        tags: ["Role"],
      },
    },
  )

  .use(Middleware.CheckRoleTerm)

  .put(
    "/create",
    async ({ body: { roleName, rolePower }, _userId, server }) => {
      const newRole = await ServiceRole.Create(roleName, rolePower, _userId);

      //WSで通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({ signal: "role::Created", data: newRole }),
      );

      return {
        message: "Role created",
        data: newRole,
      };
    },
    {
      body: t.Object({
        roleName: t.String({ minLength: 1 }),
        rolePower: t.Object({
          manageServer: t.Optional(t.Boolean()),
          manageChannel: t.Optional(t.Boolean()),
          manageRole: t.Optional(t.Boolean()),
          manageUser: t.Optional(t.Boolean()),
          manageEmoji: t.Optional(t.Boolean()),
        }),
      }),
      detail: {
        description: "ロールを作成します",
        tags: ["Role"],
      },
      checkRoleTerm: "manageRole",
    },
  )
  .post(
    "/update",
    async ({ body: { roleId, roleData }, _userId, server }) => {
      const roleUpdated = await ServiceRole.Update(roleId, roleData, _userId);

      //WSで通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({ signal: "role::Updated", data: roleUpdated }),
      );

      return {
        message: "Role updated",
        data: roleUpdated,
      };
    },
    {
      body: t.Object({
        roleId: t.String(),
        roleData: t.Object({
          name: t.String(),
          color: t.String(),
          manageServer: t.Optional(t.Boolean()),
          manageChannel: t.Optional(t.Boolean()),
          manageRole: t.Optional(t.Boolean()),
          manageUser: t.Optional(t.Boolean()),
          manageEmoji: t.Optional(t.Boolean()),
        }),
      }),
      detail: {
        description: "ロール情報を更新します",
        tags: ["Role"],
      },
      checkRoleTerm: "manageRole",
    },
  )
  .post(
    "/link",
    async ({ body: { userId, roleId }, _userId, server }) => {
      await ServiceRole.Link(userId, roleId, _userId);

      //WSで通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({ signal: "role::Linked", data: { userId, roleId } }),
      );

      return {
        message: "Role linked",
      };
    },
    {
      body: t.Object({
        userId: t.String({ notEmpty: true }),
        roleId: t.String({ notEmpty: true }),
      }),
      detail: {
        description: "ユーザーにロールを付与します",
        tags: ["Role"],
      },
      checkRoleTerm: "manageRole",
    },
  )
  .post(
    "/unlink",
    async ({ body: { userId, roleId }, _userId, server }) => {
      await ServiceRole.Unlink(userId, roleId, _userId);

      //WSで通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({ signal: "role::Unlinked", data: { userId, roleId } }),
      );

      return {
        message: "Role unlinked",
      };
    },
    {
      body: t.Object({
        userId: t.String({ notEmpty: true }),
        roleId: t.String({ notEmpty: true }),
      }),
      detail: {
        description: "ユーザーからロールを剥奪します",
        tags: ["Role"],
      },
      checkRoleTerm: "manageRole",
    },
  )
  .delete(
    "/delete",
    async ({ body: { roleId }, _userId, server }) => {
      await ServiceRole.Delete(roleId, _userId);

      //WSで通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({ signal: "role::Deleted", data: roleId }),
      );

      return {
        message: "Role deleted",
        data: roleId,
      };
    },
    {
      body: t.Object({
        roleId: t.String({ notEmpty: true }),
      }),
      detail: {
        description: "ロールを削除します",
        tags: ["Role"],
      },
      checkRoleTerm: "manageRole",
    },
  )
  .get(
    "/:roleId",
    async ({ params: { roleId } }) => {
      const role = await ServiceRole.GetInfo(roleId);

      //ロールが存在しない
      if (role === null) {
        throw status(404, "Role not found");
      }

      return {
        message: "Role info",
        data: role,
      };
    },
    {
      params: t.Object({
        roleId: t.String({ notEmpty: true }),
      }),
      detail: {
        description: "ロール情報を取得します",
        tags: ["Role"],
      },
    },
  )
  .get(
    "/list",
    async () => {
      const roles = await ServiceRole.List();

      return {
        message: "Role list",
        data: roles,
      };
    },
    {
      detail: {
        description: "ロール情報の一覧を取得します",
        tags: ["Role"],
      },
    },
  );
