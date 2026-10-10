import crypto from "node:crypto";
import { unlink } from "node:fs/promises";
import { status } from "elysia";
import sharp from "sharp";
import { db, GIRACLE_SERVER_CONFIG } from "../..";
import { invalidateTokenCache, invalidateUserCache } from "../../Middlewares";
import { QueryChannelJoin } from "../../queries/channelJoin.query";
import { QueryChannelJoinOnDefault } from "../../queries/channelJoinOnDefault.query";
import { QueryInvite } from "../../queries/invite.query";
import { QueryPassword } from "../../queries/password.query";
import { QueryRoleLink } from "../../queries/roleLink.query";
import { QueryToken } from "../../queries/token.query";
import { QueryUser } from "../../queries/user.query";
import { Util } from "../../Util";

export namespace ServiceUser {
  export const SignUp = async (
    username: string,
    password: string,
    inviteCode?: string,
  ) => {
    //SYSTEMのみ存在する状態=最初のユーザー。最初のユーザーは招待条件を確認しない
    const isFirstUser = (await QueryUser.countAll()) === 1;
    const needsInvite =
      !isFirstUser && GIRACLE_SERVER_CONFIG.RegisterInviteOnly;

    if (!GIRACLE_SERVER_CONFIG.RegisterAvailable && !isFirstUser)
      throw status(400, {
        message: "User registration is disabled",
      });

    if (needsInvite) {
      if (inviteCode === undefined) {
        throw status(400, {
          message: "Invite code is invalid",
        });
      }

      //招待コードが存在するか確認(上限判定はユーザー作成と同一トランザクション内で行う)
      const Invite = await QueryInvite.getSingle({ inviteCode });

      //招待コードが無効な場合
      if (Invite === undefined) {
        throw status(400, {
          message: "Invite code is invalid",
        });
      }
    }

    const user = await QueryUser.getSingleWithMinimumByName({ name: username });
    if (user) {
      throw status(400, {
        message: "User already exists",
      });
    }

    //ソルト生成、パスワードのハッシュ化
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHashed = await Bun.password.hash(password + salt);
    //DBへユーザー情報を登録(ユーザー・パスワード・ロール付与)
    const result = db.transaction((tx) => {
      //招待コードの使用回数を条件付きで原子的に加算(-1は無限)。上限到達なら1件も更新されない
      if (needsInvite && inviteCode) {
        const inviteUpdated = QueryInvite.consumeInTx(tx, { inviteCode });

        //上限到達のためユーザーは作成しない(トランザクションごとロールバック)
        if (inviteUpdated === undefined) {
          return { success: false as const };
        }
      }

      const newUser = QueryUser.insertInTx(tx, {
        name: username,
        selfIntroduction: `こんにちは、${username}です。`,
      });

      QueryPassword.insertInTx(tx, {
        userId: newUser.id,
        password: passwordHashed,
        salt: salt,
      });

      QueryRoleLink.insertLinkInTx(tx, {
        userId: newUser.id,
        roleId: isFirstUser ? "HOST" : "MEMBER",
      });

      return { success: true as const, newUser };
    });

    //上限到達でユーザーが作成されなかった場合
    if (!result.success) {
      throw status(400, {
        message: "Invite code reached maximum limit",
      });
    }
    const createdUser = result.newUser;

    //デフォルトで参加するチャンネルに参加させる
    const channelJoinOnDefault = await QueryChannelJoinOnDefault.getList();
    //DBへ挿入
    await QueryChannelJoin.insertMany({
      items: channelJoinOnDefault.map((c) => ({
        userId: createdUser.id,
        channelId: c.channelId,
      })),
    });

    return { createdUser };
  };

  export const SignIn = async (username: string, password: string) => {
    //ユーザー情報取得
    const user = await QueryUser.getSingleByNameWithPassword({
      name: username,
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
    //ユーザーが削除されている場合
    if (user.isDeleted) {
      throw status(401, {
        message: "User is deleted",
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
    const tokenGenerated = await QueryToken.insertToken({
      token: crypto.randomBytes(16).toString("hex"),
      userId: user.id,
    });

    return tokenGenerated;
  };

  export const GetOnline = async () => {
    //オンラインユーザーIDを取得
    const onlineUserIds = Array.from(Util.wsUserInstance.instances.keys());
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
      cursorUser = await QueryUser.getCursorUser({ userId: cursorUserId });
      if (cursorUser === undefined) {
        throw status(404, "Cursor user not found");
      }
    }

    const viewableChannels = await Util.getUserViewableChannel(_userId);

    const usersFound = await QueryUser.getList({
      viewableChannelIds: viewableChannels.map((vc) => vc.id),
      length,
      cursorUser,
      username,
      joinedChannel,
    });

    return usersFound;
  };
  export const GetUserIcon = async (userId: string) => {
    //不正なuserIdは未設定扱い(パストラバーサル対策)
    if (!Util.isSafePathId(userId)) return null;
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
    //不正なuserIdは未設定扱い(パストラバーサル対策)
    if (!Util.isSafePathId(userId)) return null;
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
    const userdata = await QueryUser.getSingleWithPassword({ userId: _userId });
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
    await QueryPassword.updatePassword({
      userId: userdata.id,
      password: await Bun.password.hash(newPassword + userdata.password.salt),
    });

    //パスワード変更時に他のセッションを無効化する(現在のセッションは維持)
    await QueryToken.removeByUserExceptToken({
      userId: userdata.id,
      exceptToken: currentToken,
    });

    //トークンキャッシュを全件無効化(現在のセッション含めDB再検証させる)
    invalidateUserCache(userdata.id);

    return;
  };

  export const ResetPassword = async (targetUserId: string) => {
    const newPassword = crypto.randomBytes(16).toString("hex");

    // ソルト再生成してハッシュ化保存（平文保存だとサインイン検証で必ず不一致になる）
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHashed = await Bun.password.hash(newPassword + salt);

    db.transaction((tx) => {
      QueryPassword.updateInTx(tx, {
        userId: targetUserId,
        password: passwordHashed,
        salt,
      });

      QueryToken.removeByUserInTx(tx, { userId: targetUserId });
    });

    // 5分トークンキャッシュに残った旧トークンを即時無効化
    invalidateUserCache(targetUserId);

    return newPassword;
  };

  export const UpdateProfile = async (
    _userId: string,
    name?: string,
    selfIntroduction?: string,
  ) => {
    //ユーザー情報取得
    const user = await QueryUser.getSingle({ userId: _userId });
    //ユーザーが存在しない場合
    if (!user) {
      throw status(404, "User not found");
    }

    //データ更新
    const userUpdated = await QueryUser.updateProfile({
      userId: user.id,
      name,
      selfIntroduction,
    });

    return userUpdated;
  };

  export const GetSessions = async (
    userId: string,
    tokenMarking: string,
    cursor: number = 1,
  ) => {
    const skipAmount = (cursor - 1) * 30;
    const sessions = await QueryToken.getListByUser({
      userId,
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
    const newSession = await QueryToken.updateName({
      sessionId,
      userId,
      name: newName,
    }).catch(() => {
      throw status(500, "Something went wrong");
    });

    //対象0件 = セッションが存在しないか自分のセッションではない
    if (newSession === undefined) {
      throw status(404, "Session not found");
    }

    return { ...newSession, token: undefined };
  };

  export const RemoveSession = async (
    _userId: string,
    sessionId: number,
    activeToken: string,
  ) => {
    const targetToken = await QueryToken.getSingleByIdAndUser({
      sessionId,
      userId: _userId,
    });

    if (targetToken === undefined) throw status(404, "Session not found");
    if (targetToken.token === activeToken)
      throw status(400, "You cannot delete your active session");

    await QueryToken.removeByIdAndUser({
      sessionId,
      userId: _userId,
    }).catch(() => {
      throw status(500, "Something went wrong");
    });

    //削除したセッションのトークンキャッシュを無効化(最大5分の猶予利用を防ぐ)
    invalidateTokenCache(targetToken.token);

    return;
  };

  export const SignOut = async (token: string) => {
    //トークン削除
    await QueryToken.removeByToken({ token });

    //トークンキャッシュを無効化(最大5分の猶予利用を防ぐ)
    invalidateTokenCache(token);

    return;
  };

  export const GetUserInfo = async (sendersUserId: string, userId: string) => {
    //リクエスト送信者の閲覧可能チャンネルから対象ユーザーの参加チャンネルをフィルターする
    const viewableChannels = await Util.getUserViewableChannel(sendersUserId);

    const user = await QueryUser.getSingleWithChannelsAndRoles({
      userId,
      viewableChannelIds: viewableChannels.map((vc) => vc.id),
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
    const userBanned = await QueryUser.setBanned({ userId, isBanned: true });

    //トークンキャッシュを無効化(最大5分間BAN前の状態でアクセスできてしまうのを防ぐ)
    invalidateUserCache(userId);

    //既存のWS接続も切断する(BAN後も新着メッセージを受信し続けられるのを防ぐ)
    Util.wsUserInstance.disconnect(userId);

    return userBanned;
  };

  export const Delete = async (userId: string, _userId: string) => {
    //SYSTEM・HOSTは削除できない
    if (userId === "SYSTEM" || userId === "HOST") {
      throw status(400, "You can't delete SYSTEM or HOST");
    }
    //自分自身を削除することはできない
    if (userId === _userId) {
      throw status(400, "You can't delete yourself");
    }
    //ユーザーが存在しない場合
    const targetUser = await QueryUser.getSingleWithMinimum({ userId });
    if (targetUser === undefined) {
      throw status(404, "User not found");
    }
    //既に削除済みの場合
    if (targetUser.isDeleted) {
      throw status(400, "User already deleted");
    }
    //ロールレベルが対象より低いと削除できない
    if (
      (await Util.getUsersRoleLevel(_userId)) <
      (await Util.getUsersRoleLevel(userId))
    ) {
      throw status(400, "You can't delete higher role level user");
    }

    //キャッシュ無効化用に既存トークン一覧を取得
    const userTokens = await QueryToken.getTokensByUser({ userId });

    //論理削除（メッセージ・絵文字・チャンネル等のデータは全て残る）
    await QueryUser.setDeleted({ userId });

    //全セッションを無効化
    await QueryToken.removeByUser({ userId });

    //トークンキャッシュを無効化(最大5分の猶予利用を防ぐ)
    invalidateUserCache(userId);
    for (const userToken of userTokens) {
      invalidateTokenCache(userToken.token);
    }

    //既存のWS接続も切断する
    Util.wsUserInstance.disconnect(userId);

    return;
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
    const userUnbanned = await QueryUser.setBanned({
      userId,
      isBanned: false,
    });

    //BAN状態のキャッシュを無効化する
    invalidateUserCache(userId);

    return userUnbanned;
  };
}
