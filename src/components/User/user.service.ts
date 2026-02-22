import crypto from "node:crypto";
import { unlink } from "node:fs/promises";
import { status } from "elysia";
import sharp from "sharp";
import { db } from "../..";
import CheckChannelVisibility from "../../Utils/CheckChannelVisitiblity";
import getUsersRoleLevel from "../../Utils/getUsersRoleLevel";
import { userWSInstance } from "../../ws";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";

export namespace ServiceUser {
  export const SignUp = async (
    username: string,
    password: string,
    inviteCode?: string,
  ) => {
    //初めてのユーザーかどうか
    let flagFirstUser = false;
    //ユーザー数を取得して最初ならtrue
    const num = await db.user.count();
    if (num === 1) {
      flagFirstUser = true;
    }

    //最初のユーザーなら招待条件を確認しない
    if (!flagFirstUser) {
      //サーバーの設定を取得して招待関連の条件を確認
      const serverConfig = await db.serverConfig.findFirst();
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
        const Invite = await db.invitation.findUnique({
          where: { inviteCode: inviteCode },
        });
        //招待コードが無効な場合
        if (Invite === null) {
          throw status(400, {
            message: "Invite code is invalid",
          });
        }
        //---------------------------------------
        //使用回数を加算
        await db.invitation.update({
          where: { inviteCode: inviteCode },
          data: {
            usedCount: Invite.usedCount + 1,
          },
        });
      }
    }

    const user = await db.user.findUnique({
      where: { name: username },
    });
    if (user) {
      throw status(400, {
        message: "User already exists",
      });
    }

    //ソルト生成、パスワードのハッシュ化
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHashed = await Bun.password.hash(password + salt);
    //DBへユーザー情報を登録
    const createdUser = await db.user.create({
      data: {
        name: username,
        selfIntroduction: `こんにちは、${username}です。`,
        password: {
          create: {
            password: passwordHashed,
            salt: salt,
          },
        },
        RoleLink: {
          create: {
            roleId: flagFirstUser ? "HOST" : "MEMBER",
          },
        },
      },
    });

    //デフォルトで参加するチャンネルに参加させる
    const channelJoinOnDefault = await db.channelJoinOnDefault.findMany({});
    const joiningData: { userId: string; channelId: string }[] = [];
    for (const channelIdJson of channelJoinOnDefault) {
      joiningData.push({
        userId: createdUser.id,
        channelId: channelIdJson.channelId,
      });
    }
    //DBへ挿入
    await db.channelJoin.createMany({
      data: joiningData,
    });

    return { createdUser };
  };

  export const SignIn = async (username: string, password: string) => {
    //ユーザー情報取得
    const user = await db.user.findUnique({
      where: { name: username },
      include: {
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
    const tokenGenerated = await db.token.create({
      data: {
        token: crypto.randomBytes(16).toString("hex"),
        user: {
          connect: {
            name: username,
          },
        },
      },
    });

    return tokenGenerated;
  };

  export const GetOnline = async () => {
    //オンラインユーザーIDを取得
    const onlineUserIds = Array.from(userWSInstance.keys());
    //重複を削除
    const uniqueOnlineUserIds = Array.from(new Set(onlineUserIds)).map(String);

    return uniqueOnlineUserIds;
  };

  export const Search = async (
    _userId: string,
    username?: string,
    joinedChannel?: string,
    cursor = 0,
  ) => {
    //チャンネル指定をしているならそれぞれが閲覧可能であるかを調べる
    if (joinedChannel !== undefined) {
      const canView = await CheckChannelVisibility(joinedChannel, _userId);
      if (canView === false) {
        throw status(
          403,
          "You can't search this channel due to visibility restrictions",
        );
      }
    }

    //ユーザーを検索
    const users = await db.user.findMany({
      take: 30,
      skip: cursor * 30,
      where: {
        name: {
          contains: username,
        },
        ChannelJoin: {
          some: {
            channelId: joinedChannel === "" ? undefined : joinedChannel,
          },
        },
      },
      include: {
        ChannelJoin: {
          select: {
            channelId: true,
          },
        },
        RoleLink: {
          select: {
            roleId: true,
          },
        },
      },
    });

    return users;
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
  ) => {
    //ユーザー情報取得
    const userdata = await db.user.findFirst({
      where: {
        id: _userId,
      },
      include: {
        password: true,
      },
    });
    //ユーザー情報、またはその中のパスワードが取得できない場合
    if (userdata === null || userdata.password === null) {
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
    await db.password.update({
      where: {
        userId: userdata.id,
      },
      data: {
        password: await Bun.password.hash(newPassword + userdata.password.salt),
      },
    });

    return;
  };

  export const UpdateProfile = async (
    _userId: string,
    name?: string,
    selfIntroduction?: string,
  ) => {
    //ユーザー情報取得
    const user = await db.user.findUnique({
      where: {
        id: _userId,
      },
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
    const userUpdated = await db.user.update({
      where: {
        id: user.id,
      },
      data: updatingValue,
    });

    return userUpdated;
  };

  export const GetSessions = async (userId: string, tokenMarking: string, cursor: number = 1) => {
    const skipAmount = (cursor - 1) * 30;
    const sessions = await db.token.findMany({
      where: {
        userId
      },
      take: 30,
      skip: skipAmount
    });

    return sessions.map((session) => ({
      ...session,
      thisIsYou: session.token === tokenMarking,
      token: undefined
    }));
  };

  export const ChangeSessionName = async (userId: string, sessionId: number, newName: string) => {
    const newSession = await db.token.update({
      where: {
        id: sessionId,
        userId
      },
      data: {
        name: newName
      }
    }).catch((e) => {
      if (e instanceof PrismaClientKnownRequestError) {
        // P2025 は「対象のレコードが見つからなかった」際のエラーコード
        if (e.code === "P2025") {
          throw status(404, "Session not found");
        }
      }
      throw status(500, "Something went wrong");
    });

    return { ...newSession, token: undefined };
  };

  export const RemoveSession = async (userId: string, sessionId: number, activeToken: string) => {
    const targetToken = await db.token.findUnique({
      where: {
        id: sessionId
      }
    });

    if (targetToken === null) throw status(404, "Session not found");
    if (targetToken.token === activeToken) throw status(400, "You cannot delete your active session");

    await db.token.delete({
      where: {
        id: sessionId
      }
    }).catch(() => {
      throw status(500, "Something went wrong");
    });

    return;
  };

  export const SignOut = async (token: string) => {
    //トークン削除
    await db.token.delete({
      where: {
        token: token,
      },
    });

    return;
  };

  export const GetUserInfo = async (userId: string) => {
    const user = await db.user.findFirst({
      where: {
        id: userId,
      },
      include: {
        ChannelJoin: {
          select: {
            channelId: true,
          },
        },
        RoleLink: {
          select: {
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

  export const GetUserList = async () => {
    const users = await db.user.findMany({
      include: {
        ChannelJoin: {
          select: {
            channelId: true,
          },
        },
        RoleLink: {
          select: {
            roleId: true,
          },
        },
      },
    });

    return users;
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
      (await getUsersRoleLevel(_userId)) < (await getUsersRoleLevel(userId))
    ) {
      throw status(400, "You can't ban higher role level user");
    }

    //BANする
    const userBanned = await db.user.update({
      where: {
        id: userId,
      },
      data: {
        isBanned: true,
      },
    });

    return userBanned;
  };

  export const Unban = async (userId: string, _userId: string) => {
    //自分自身をUNBANすることはできない
    if (userId === _userId) {
      throw status(400, "You can't unban yourself");
    }
    //ロールレベルが対象より低いとBAN解除できない
    if (
      (await getUsersRoleLevel(_userId)) < (await getUsersRoleLevel(userId))
    ) {
      throw status(400, "You can't unban higher role level user");
    }

    //BANを解除
    const userUnbanned = await db.user.update({
      where: {
        id: userId,
      },
      data: {
        isBanned: false,
      },
    });

    return userUnbanned;
  };
}
