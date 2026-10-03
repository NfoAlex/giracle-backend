import { db } from "..";
import { serverConfigs } from "../db/schema";

export namespace QueryServerConfig {
  //サーバー設定
  export const getSingle = () => {
    return db.query.serverConfigs.findFirst();
  };

  export const updateInfo = async (query: {
    name: string;
    introduction: string;
  }) => {
    const [serverinfo] = await db
      .update(serverConfigs)
      .set({
        name: query.name,
        introduction: query.introduction,
      })
      .returning();

    return serverinfo;
  };

  export const updateConfig = async (query: {
    RegisterAvailable?: boolean;
    RegisterInviteOnly?: boolean;
    RegisterAnnounceChannelId?: string;
    MessageMaxLength?: number;
    MessageMaxFileSize?: number;
  }) => {
    const [serverinfo] = await db
      .update(serverConfigs)
      .set({
        RegisterAvailable: query.RegisterAvailable,
        RegisterInviteOnly: query.RegisterInviteOnly,
        RegisterAnnounceChannelId: query.RegisterAnnounceChannelId,
        MessageMaxLength: query.MessageMaxLength,
        MessageMaxFileSize: query.MessageMaxFileSize,
      })
      .returning();

    return serverinfo;
  };
}
