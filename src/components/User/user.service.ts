import crypto from "node:crypto";
import { unlink } from "node:fs/promises";
import { and, asc, eq, gt, inArray, not, or, sql } from "drizzle-orm";
import { status } from "elysia";
import sharp from "sharp";
import { db, GIRACLE_SERVER_CONFIG } from "../..";
import {
  channelJoins,
  invitations,
  passwords,
  roleLinks,
  tokens,
  users,
} from "../../db/schema";
import { invalidateTokenCache, invalidateUserCache } from "../../Middlewares";
import { Util } from "../../Util";
import { userWSInstance } from "../../ws";

export namespace ServiceUser {
  export const SignUp = async (
    username: string,
    password: string,
    inviteCode?: string,
  ) => {
    //初めてのユーザーかどうか
    let flagFirstUser = false;
    //ユーザー数を取得して最初ならtrue
    const num = await db.$count(users);
    if (num === 1) {
      flagFirstUser = true;
    }

    //最初のユーザーなら招待条件を確認しない
    if (!flagFirstUser) {
      //サーバーの設定を取得して招待関連の条件を確認
      const serverConfig = await db.query.serverConfigs.findFirst();
      if (!serverConfig?.RegisterAvailable) {
        throw status(400, {
          message: "Registration is disabled",
        });
      }
      if (serverConfig?.RegisterInviteOnly) {
        if (inviteCode === undefined) {
          throw status(400, {
            message: "Invite code is invalid",
          });
        }

        //招待コードが有効か確認
        const Invite = await db.query.invitations.findFirst({
          where: eq(invitations.inviteCode, inviteCode),
          columns: { maxUsage: true, usedCount: true },
        });

        //招待コードが無効な場合
        if (Invite === undefined) {
          throw status(400, {
            message: "Invite code is invalid",
          });
        }
        //招待コードの使用回数を検証(-1は無限)
        if (Invite.usedCount >= Invite.maxUsage && Invite.maxUsage !== -1) {
          throw status(400, {
            message: "Invite code reached maximum limit",
          });
        }
      }
    }

    const user = await db.query.users.findFirst({
      where: eq(users.name, username),
    });
    if (user) {
      throw status(400, {
        message: "User already exists",
      });
    }

    //ソルト生成、パスワードのハッシュ化
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHashed = await Bun.password.hash(password + salt);
    //DBへユーザー情報を登録(ユーザー・パスワード・ロール付与を1トランザクションで)
    const createdUser = db.transaction((tx) => {
      const newUser = tx
        .insert(users)
        .values({
          name: username,
          selfIntroduction: `こんにちは、${username}です。`,
        })
        .returning()
        .get();

      tx.insert(passwords)
        .values({
          userId: newUser.id,
          password: passwordHashed,
          salt: salt,
        })
        .run();

      tx.insert(roleLinks)
        .values({
          userId: newUser.id,
          roleId: flagFirstUser ? "HOST" : "MEMBER",
        })
        .run();

      return newUser;
    });

    //デフォルトで参加するチャンネルに参加させる
    const channelJoinOnDefault =
      await db.query.channelJoinOnDefaults.findMany();
    const joiningData: { userId: string; channelId: string }[] = [];
    for (const channelIdJson of channelJoinOnDefault) {
      joiningData.push({
        userId: createdUser.id,
        channelId: channelIdJson.channelId,
      });
    }
    //DBへ挿入
    if (joiningData.length > 0) {
      await db.insert(channelJoins).values(joiningData);
    }

    //招待の使用回数を加算(競合対策のためDB側で加算するsqlを使用)
    if (GIRACLE_SERVER_CONFIG.RegisterInviteOnly && inviteCode) {
      await db
        .update(invitations)
        .set({
          usedCount: sql`${invitations.usedCount} + 1`,
        })
        .where(eq(invitations.inviteCode, inviteCode));
    }

    return { createdUser };
  };

  export const SignIn = async (username: string, password: string) => {
    //ユーザー情報取得
    const user = await db.query.users.findFirst({
      where: eq(users.name, username),
      with: {
        password: true,
      },
    });

    //ユーザーが存在しない場合
    if (!user) {
      throw status(400, {
        message: "Auth info is incorrect",
      });
    }
    //パスワードが設定されていない場合
    if (!user.password) {
      throw status(400, {
        message: "Internal error",
      });
    }
    //ユーザーがBANされている場合
    if (user.isBanned) {
      throw status(401, {
        message: "User is banned",
      });
    }

    //パスワードのハッシュ化
    const passwordCheckResult = await Bun.password.verify(
      password + user.password?.salt,
      user.password.password,
    );

    //パスワードが一致しない場合
    if (!passwordCheckResult) {
      throw status(400, {
        message: "Auth info is incorrect",
      });
    }

    //トークンを生成
    const [tokenGenerated] = await db
      .insert(tokens)
      .values({
        token: crypto.randomBytes(16).toString("hex"),
        userId: user.id,
      })
      .returning();

    return tokenGenerated;
  };

  export const GetOnline = async () => {
    //オンラインユーザーIDを取得
    const onlineUserIds = Array.from(userWSInstance.keys());
    //重複を削除
    const uniqueOnlineUserIds = Array.from(new Set(onlineUserIds)).map(String);

    return uniqueOnlineUserIds;
  };

  export const GetUserList = async (
    _userId: string,
    length: number = 30,
    cursorUserId?: string,
    username?: string,
    joinedChannel?: string,
  ) => {
    //チャンネル指定をしているならそれぞれが閲覧可能であるかを調べる(空文字は全チャンネル参加者指定のため対象外)
    if (joinedChannel !== undefined && joinedChannel !== "") {
      const canView = await Util.checkChannelVisibility(joinedChannel, _userId);
      if (canView === false) {
        throw status(
          403,
          "You can't search this channel due to visibility restrictions",
        );
      }
    }

    if (cursorUserId === "SYSTEM") {
      throw status(404, "Cursor user not found");
    }
    let cursorUser: { createdAt: Date; id: string } | undefined;
    if (cursorUserId) {
      cursorUser = await db.query.users.findFirst({
        columns: { createdAt: true, id: true },
        where: eq(users.id, cursorUserId),
      });
      if (cursorUser === undefined) {
        throw status(404, "Cursor user not found");
      }
    }

    //検索条件を組み立て
    const conditions = [];
    if (username !== undefined) {
      //ワイルドカード(%,_)を無効化してLIKE検索(前方一致)
      const escapedQuery = Util.escapeLikePattern(username);
      conditions.push(
        sql`${users.name} LIKE ${`${escapedQuery}%`} ESCAPE '\\'`,
      );
    }
    if (joinedChannel !== undefined) {
      //指定チャンネルへ参加しているユーザーIdをサブクエリで絞る(空文字ならいずれかのチャンネルへ参加しているユーザー)
      conditions.push(
        inArray(
          users.id,
          db
            .select({ userId: channelJoins.userId })
            .from(channelJoins)
            .where(
              joinedChannel !== ""
                ? eq(channelJoins.channelId, joinedChannel)
                : undefined,
            ),
        ),
      );
    }

    const usersFound = await db.query.users.findMany({
      where: and(
        not(eq(users.id, "SYSTEM")),
        // 日付とユーザーId基準で取得
        cursorUser
          ? or(
              gt(users.createdAt, cursorUser.createdAt),
              // 同じ秒で作成されたとき用考慮
              and(
                eq(users.createdAt, cursorUser.createdAt),
                gt(users.id, cursorUser.id),
              ),
            )
          : undefined,
        // ユーザー名・参加チャンネルによる絞り込み
        conditions.length > 0 ? and(...conditions) : undefined,
      ),
      orderBy: [asc(users.createdAt), asc(users.id)],
      with: {
        RoleLink: {
          columns: {
            roleId: true,
          },
        },
      },
      limit: length,
    });

    return usersFound;
  };
  export const GetUserIcon = async (userId: string) => {
    //アイコン読み取り、存在確認して返す
    const iconFilePng = Bun.file(`./STORAGE/icon/${userId}.png`);
    if (await iconFilePng.exists()) {
      return iconFilePng;
    }
    const iconFileGif = Bun.file(`./STORAGE/icon/${userId}.gif`);
    if (await iconFileGif.exists()) {
      return iconFileGif;
    }
    const iconFileJpeg = Bun.file(`./STORAGE/icon/${userId}.jpeg`);
    if (await iconFileJpeg.exists()) {
      return iconFileJpeg;
    }
    const iconFileWebp = Bun.file(`./STORAGE/icon/${userId}.webp`);
    if (await iconFileWebp.exists()) {
      return iconFileWebp;
    }

    return null;
  };

  export const GetUserBanner = async (userId: string) => {
    //アイコン読み取り、存在確認して返す
    const bannerFilePng = Bun.file(`./STORAGE/banner/${userId}.png`);
    if (await bannerFilePng.exists()) {
      return bannerFilePng;
    }
    const bannerFileGif = Bun.file(`./STORAGE/banner/${userId}.gif`);
    if (await bannerFileGif.exists()) {
      return bannerFileGif;
    }
    const bannerFileJpeg = Bun.file(`./STORAGE/banner/${userId}.jpeg`);
    if (await bannerFileJpeg.exists()) {
      return bannerFileJpeg;
    }
    const bannerFileWebp = Bun.file(`./STORAGE/banner/${userId}.webp`);
    if (await bannerFileWebp.exists()) {
      return bannerFileWebp;
    }

    return null;
  };

  export const ChangeIcon = async (icon: File, _userId: string) => {
    if (icon.size > 8 * 1024 * 1024) {
      throw status(400, "File size is too large");
    }
    if (
      icon.type !== "image/png" &&
      icon.type !== "image/gif" &&
      icon.type !== "image/jpeg"
    ) {
      throw status(400, "File type is invalid");
    }
    //拡張子取得
    const ext = icon.type.split("/")[1];

    //既存のアイコンを削除
    await unlink(`./STORAGE/icon/${_userId}.png`).catch(() => {});
    await unlink(`./STORAGE/icon/${_userId}.gif`).catch(() => {});
    await unlink(`./STORAGE/icon/${_userId}.jpeg`).catch(() => {});
    await unlink(`./STORAGE/icon/${_userId}.webp`).catch(() => {});

    //画像を圧縮、保存する(GIFとそれ以外で処理を分ける)
    if (ext === "gif") {
      await sharp(await icon.arrayBuffer(), { animated: true })
        .resize(125, 125)
        .gif({
          colours: 128, // 色数を128に削減
          dither: 0, // ディザリングを無効化
          effort: 7, // パレット生成の計算量を設定
        })
        .toFile(`./STORAGE/icon/${_userId}.gif`);
    } else {
      await sharp(await icon.arrayBuffer())
        .resize(125, 125)
        .webp({ quality: 90 })
        .toFile(`./STORAGE/icon/${_userId}.webp`);
    }

    return;
  };

  export const ChangeBanner = async (banner: File, _userId: string) => {
    if (banner.size > 10 * 1024 * 1024) {
      throw status(400, "File size is too large");
    }
    if (
      banner.type !== "image/png" &&
      banner.type !== "image/gif" &&
      banner.type !== "image/jpeg"
    ) {
      throw status(400, "File type is invalid");
    }
    //拡張子取得
    const ext = banner.type.split("/")[1];

    //既存のバナーを削除
    await unlink(`./STORAGE/banner/${_userId}.png`).catch(() => {});
    await unlink(`./STORAGE/banner/${_userId}.gif`).catch(() => {});
    await unlink(`./STORAGE/banner/${_userId}.jpeg`).catch(() => {});
    await unlink(`./STORAGE/banner/${_userId}.webp`).catch(() => {});

    //画像を圧縮、保存する
    if (ext === "gif") {
      await sharp(await banner.arrayBuffer(), { animated: true })
        .gif({
          colours: 128, // 色数を128に削減
          dither: 0, // ディザリングを無効化
          effort: 7, // パレット生成の計算量を設定
        })
        .toFile(`./STORAGE/banner/${_userId}.gif`);
    } else {
      await sharp(await banner.arrayBuffer())
        .rotate()
        .webp({ quality: 90 })
        .toFile(`./STORAGE/banner/${_userId}.webp`);
    }

    return;
  };

  export const ChangePassword = async (
    currentPassword: string,
    newPassword: string,
    _userId: string,
    currentToken: string,
  ) => {
    //ユーザー情報取得
    const userdata = await db.query.users.findFirst({
      where: eq(users.id, _userId),
      with: {
        password: true,
      },
    });
    //ユーザー情報、またはその中のパスワードが取得できない場合
    if (userdata === undefined || userdata.password === null) {
      throw status(500, "Internal Server Error");
    }

    //現在のパスワードが正しいか確認
    const passwordCheckResult = await Bun.password.verify(
      currentPassword + userdata.password.salt,
      userdata.password.password,
    );
    //パスワードが一致しない場合
    if (!passwordCheckResult) {
      throw status(401, {
        message: "Current password is incorrect",
      });
    }

    //新しいパスワードをハッシュ化してDBに保存
    await db
      .update(passwords)
      .set({
        password: await Bun.password.hash(newPassword + userdata.password.salt),
      })
      .where(eq(passwords.userId, userdata.id));

    //パスワード変更時に他のセッションを無効化する(現在のセッションは維持)
    await db
      .delete(tokens)
      .where(
        and(
          eq(tokens.userId, userdata.id),
          not(eq(tokens.token, currentToken)),
        ),
      );

    //トークンキャッシュを全件無効化(現在のセッション含めDB再検証させる)
    invalidateUserCache(userdata.id);

    return;
  };

  export const UpdateProfile = async (
    _userId: string,
    name?: string,
    selfIntroduction?: string,
  ) => {
    //ユーザー情報取得
    const user = await db.query.users.findFirst({
      where: eq(users.id, _userId),
    });
    //ユーザーが存在しない場合
    if (!user) {
      throw status(404, "User not found");
    }

    // 更新データの準備
    const updatingValue: { name?: string; selfIntroduction?: string } = {};
    if (name !== undefined) {
      updatingValue.name = name;
    }
    if (selfIntroduction !== undefined) {
      updatingValue.selfIntroduction = selfIntroduction;
    }

    //データ更新
    const [userUpdated] = await db
      .update(users)
      .set(updatingValue)
      .where(eq(users.id, user.id))
      .returning();

    return userUpdated;
  };

  export const GetSessions = async (
    userId: string,
    tokenMarking: string,
    cursor: number = 1,
  ) => {
    const skipAmount = (cursor - 1) * 30;
    const sessions = await db.query.tokens.findMany({
      where: eq(tokens.userId, userId),
      limit: 30,
      offset: skipAmount,
    });

    return sessions.map((session) => ({
      ...session,
      thisIsYou: session.token === tokenMarking,
      token: undefined,
    }));
  };

  export const ChangeSessionName = async (
    userId: string,
    sessionId: number,
    newName: string,
  ) => {
    const [newSession] = await db
      .update(tokens)
      .set({ name: newName })
      .where(and(eq(tokens.id, sessionId), eq(tokens.userId, userId)))
      .returning()
      .catch(() => {
        throw status(500, "Something went wrong");
      });

    //対象0件 = セッションが存在しないか自分のセッションではない
    if (newSession === undefined) {
      throw status(404, "Session not found");
    }

    return { ...newSession, token: undefined };
  };

  export const RemoveSession = async (
    sessionId: number,
    activeToken: string,
  ) => {
    const targetToken = await db.query.tokens.findFirst({
      where: eq(tokens.id, sessionId),
    });

    if (targetToken === undefined) throw status(404, "Session not found");
    if (targetToken.token === activeToken)
      throw status(400, "You cannot delete your active session");

    await db
      .delete(tokens)
      .where(eq(tokens.id, sessionId))
      .catch(() => {
        throw status(500, "Something went wrong");
      });

    //削除したセッションのトークンキャッシュを無効化(最大5分の猶予利用を防ぐ)
    invalidateTokenCache(targetToken.token);

    return;
  };

  export const SignOut = async (token: string) => {
    //トークン削除
    await db.delete(tokens).where(eq(tokens.token, token));

    //トークンキャッシュを無効化(最大5分の猶予利用を防ぐ)
    invalidateTokenCache(token);

    return;
  };

  export const GetUserInfo = async (sendersUserId: string, userId: string) => {
    //リクエスト送信者の閲覧可能チャンネルから対象ユーザーの参加チャンネルをフィルターする
    const viewableChannels = await Util.getUserViewableChannel(sendersUserId);

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      with: {
        ChannelJoin: {
          columns: {
            channelId: true,
          },
          where: inArray(
            channelJoins.channelId,
            viewableChannels.map((vc) => vc.id),
          ),
        },
        RoleLink: {
          columns: {
            roleId: true,
          },
        },
      },
    });
    //ユーザーが存在しない場合
    if (!user) {
      throw status(404, "User not found");
    }

    return user;
  };

  export const Ban = async (userId: string, _userId: string) => {
    //HOSTをBANすることはできない
    if (userId === "HOST") {
      throw status(400, "You can't ban HOST");
    }
    //自分自身をBANすることはできない
    if (userId === _userId) {
      throw status(400, "You can't ban yourself");
    }
    //ロールレベルが対象より低いとBANできない
    if (
      (await Util.getUsersRoleLevel(_userId)) <
      (await Util.getUsersRoleLevel(userId))
    ) {
      throw status(400, "You can't ban higher role level user");
    }

    //BANする
    const [userBanned] = await db
      .update(users)
      .set({ isBanned: true })
      .where(eq(users.id, userId))
      .returning();

    //トークンキャッシュを無効化(最大5分間BAN前の状態でアクセスできてしまうのを防ぐ)
    invalidateUserCache(userId);

    return userBanned;
  };

  export const Unban = async (userId: string, _userId: string) => {
    //自分自身をUNBANすることはできない
    if (userId === _userId) {
      throw status(400, "You can't unban yourself");
    }
    //ロールレベルが対象より低いとBAN解除できない
    if (
      (await Util.getUsersRoleLevel(_userId)) <
      (await Util.getUsersRoleLevel(userId))
    ) {
      throw status(400, "You can't unban higher role level user");
    }

    //BANを解除
    const [userUnbanned] = await db
      .update(users)
      .set({ isBanned: false })
      .where(eq(users.id, userId))
      .returning();

    //BAN状態のキャッシュを無効化する
    invalidateUserCache(userId);

    return userUnbanned;
  };
}
