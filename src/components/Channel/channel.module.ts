import Elysia, { status, t } from "elysia";
import { db } from "../..";
import { Middleware } from "../../Middlewares";
import SendSystemMessage from "../../Utils/SendSystemMessage";
import { WSSubscribe, WSUnsubscribe } from "../../ws";
import { ServiceChannel } from "./channel.service";

export const channel = new Elysia({ prefix: "/channel" })
  .use(Middleware.CheckToken)
  .post(
    "/join",
    async ({ body: { channelId }, CheckToken: { _userId }, server }) => {
      //参加処理
      await ServiceChannel.Join(channelId, _userId);

      //WS登録させる
      //userWSInstance.get(_userId)?.subscribe(`channel::${channelId}`);
      WSSubscribe(_userId, `channel::${channelId}`);
      //システムメッセージを送信
      SendSystemMessage(channelId, _userId, "CHANNEL_JOIN", server);

      //WSでチャンネル参加を通知
      server?.publish(
        `user::${_userId}`,
        JSON.stringify({
          signal: "channel::Join",
          data: {
            channelId,
          },
        }),
      );

      return {
        message: "Channel joined",
        data: {
          channelId,
        },
      };
    },
    {
      body: t.Object({
        channelId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "チャンネルに参加します",
        tags: ["Channel"],
      },
      response: {
        200: t.Object({
          message: t.Literal("Channel joined"),
          data: t.Object({
            channelId: t.String(),
          }),
        }),
        400: t.Literal("Already joined"),
        404: t.Literal("Channel not found"),
      },
    },
  )
  .post(
    "/leave",
    async ({ body: { channelId }, CheckToken: { _userId }, server }) => {
      //チャンネル退出処理
      await ServiceChannel.Leave(channelId, _userId);

      //WS登録を解除させる
      //userWSInstance.get(_userId)?.unsubscribe(`channel::${channelId}`);
      WSUnsubscribe(_userId, `channel::${channelId}`);
      //システムメッセージを送信
      SendSystemMessage(channelId, _userId, "CHANNEL_LEFT", server);

      //WSでチャンネル退出を通知
      server?.publish(
        `user::${_userId}`,
        JSON.stringify({
          signal: "channel::Left",
          data: {
            channelId,
          },
        }),
      );

      return {
        message: "Channel left",
      };
    },
    {
      body: t.Object({
        channelId: t.String({ minLength: 1 }),
      }),
      detail: {
        description: "チャンネルから退出します",
        tags: ["Channel"],
      },
      response: {
        200: t.Object({
          message: t.Literal("Channel left"),
        }),
        400: t.Literal("You are not joined this channel"),
      },
    },
  )
  .get(
    "/get-info/:channelId",
    async ({ params: { channelId }, CheckToken: { _userId } }) => {
      const channelData = await ServiceChannel.GetInfo(channelId, _userId);

      return {
        message: "Channel info ready",
        data: channelData,
      };
    },
    {
      params: t.Object({
        channelId: t.String(),
      }),
      detail: {
        description: "チャンネル単体の情報を取得します",
        tags: ["Channel"],
      },
    },
  )
  .get(
    "/list",
    async ({ CheckToken: { _userId } }) => {
      const ChannelList = await ServiceChannel.List(_userId);

      return {
        message: "Channel list ready",
        data: ChannelList,
      };
    },
    {
      detail: {
        description: "チャンネル一覧を取得します",
        tags: ["Channel"],
      },
    },
  )
  .post(
    "/get-history/:channelId",
    async ({ params: { channelId }, body, CheckToken: { _userId } }) => {
      const results = await ServiceChannel.GetHistory(channelId, body, _userId);

      return {
        message: "History fetched",
        data: {
          history: results.history, //履歴データ
          ImageDimensions: results.ImageDimensions, //画像用のサイズデータ(縦幅、横幅)
          atTop: results.atTop, //最初まで取得したかどうか
          atEnd: results.atEnd, //最新まで取得したかどうか
        },
      };
    },
    {
      params: t.Object({
        channelId: t.String(),
      }),
      body: t.Optional(
        t.Object({
          messageIdFrom: t.Optional(t.String()),
          messageTimeFrom: t.Optional(t.String()),
          fetchLength: t.Number({ default: 30, maximum: 30 }),
          fetchDirection: t.Union([t.Literal("older"), t.Literal("newer")], {
            default: "older",
          }),
        }),
      ),
      detail: {
        description: "チャンネルのメッセージ履歴を取得します",
        tags: ["Channel"],
      },
    },
  )
  .get(
    "/search",
    async ({ query: { query }, CheckToken: { _userId } }) => {
      const channelInfos = await ServiceChannel.Search(query, _userId);

      return {
        message: "Searched channels",
        data: channelInfos,
      };
    },
    {
      query: t.Object({
        query: t.String(),
      }),
      detail: {
        description: "チャンネル情報を検索します",
        tags: ["Channel"],
      },
    },
  )

  .use(Middleware.CheckRoleTerm)

  .post(
    "/invite",
    async ({ body: { channelId, userId }, CheckToken: { _userId }, server }) => {
      //招待処理
      await ServiceChannel.Invite(channelId, userId, _userId);

      //WSチャンネルを登録させる
      WSSubscribe(userId, `channel::${channelId}`);

      //システムメッセージを送信
      SendSystemMessage(channelId, userId, "CHANNEL_INVITED", server);

      //チャンネル参加を本人にWSで通知
      server?.publish(
        `user::${userId}`,
        JSON.stringify({
          signal: "channel::Join",
          data: {
            channelId,
          },
        }),
      );

      return {
        message: "User invited",
      };
    },
    {
      body: t.Object({
        channelId: t.String(),
        userId: t.String(),
      }),
      detail: {
        description: "チャンネルにユーザーを招待します",
        tags: ["Channel"],
      },
      checkRoleTerm: "manageChannel",
    },
  )
  .post(
    "/kick",
    async ({ body: { channelId, userId }, CheckToken: { _userId }, server }) => {
      //キック処理
      await ServiceChannel.Kick(channelId, userId, _userId);

      //WSチャンネルを登録解除
      WSUnsubscribe(userId, `channel::${channelId}`);

      //システムメッセージを送信
      SendSystemMessage(channelId, userId, "CHANNEL_KICKED", server);

      //チャンネル退出を本人にWSで通知
      server?.publish(
        `user::${userId}`,
        JSON.stringify({
          signal: "channel::Left",
          data: {
            channelId,
          },
        }),
      );

      return {
        message: "User kicked",
      };
    },
    {
      body: t.Object({
        channelId: t.String(),
        userId: t.String(),
      }),
      detail: {
        description: "チャンネルからユーザーをキックします",
        tags: ["Channel"],
      },
      checkRoleTerm: "manageChannel",
    },
  )
  .post(
    "/update",
    async ({
      body: { name, description, isArchived, channelId, viewableRole },
      server,
      CheckToken: { _userId }
    }) => {
      const channelDataUpdated = await ServiceChannel.Update(
        channelId,
        name,
        description,
        isArchived,
        viewableRole,
        _userId,
      );

      //WSで通知
      server?.publish(
        "GLOBAL",
        JSON.stringify({
          signal: "channel::UpdateChannel",
          data: channelDataUpdated,
        }),
      );

      return {
        message: "Channel updated",
        data: channelDataUpdated,
      };
    },
    {
      body: t.Object({
        channelId: t.String({ minLength: 1 }),
        name: t.Optional(t.String()),
        description: t.Optional(t.String()),
        viewableRole: t.Optional(t.Array(t.String())),
        isArchived: t.Optional(t.Boolean()),
      }),
      detail: {
        description: "チャンネル情報を更新します",
        tags: ["Channel"],
      },
      checkRoleTerm: "manageChannel",
    },
  )
  .put(
    "/create",
    async ({ body: { channelName, description = "" }, CheckToken: { _userId } }) => {
      const newChannel = await ServiceChannel.Create(
        channelName,
        description,
        _userId,
      );

      return {
        message: "Channel created",
        data: {
          channelId: newChannel.id,
        },
      };
    },
    {
      body: t.Object({
        channelName: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
      }),
      detail: {
        description: "チャンネルを作成します",
        tags: ["Channel"],
      },
      checkRoleTerm: "manageChannel",
    },
  )
  .delete(
    "/delete",
    async ({ body: { channelId }, server, CheckToken: { _userId } }) => {
      //チャンネル削除処理
      await ServiceChannel.Delete(channelId, _userId, server);

      return {
        message: "Channel deleted",
      };
    },
    {
      body: t.Object({
        channelId: t.String(),
      }),
      detail: {
        description: "チャンネルを削除します",
        tags: ["Channel"],
      },
      checkRoleTerm: "manageChannel",
    },
  );
