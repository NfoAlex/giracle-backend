import { relations } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// ============================================================
// テーブル定義
// ============================================================

export const users = sqliteTable("User", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").unique(),
  selfIntroduction: text("selfIntroduction").notNull(),
  isBanned: integer("isBanned", { mode: "boolean" }).notNull().default(false),
});

export const roleInfos = sqliteTable("RoleInfo", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  createdUserId: text("createdUserId")
    .notNull()
    .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  color: text("color").notNull().default("#fff"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  manageServer: integer("manageServer", { mode: "boolean" })
    .notNull()
    .default(false),
  manageChannel: integer("manageChannel", { mode: "boolean" })
    .notNull()
    .default(false),
  manageUser: integer("manageUser", { mode: "boolean" })
    .notNull()
    .default(false),
  manageRole: integer("manageRole", { mode: "boolean" })
    .notNull()
    .default(false),
  manageEmoji: integer("manageEmoji", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const channels = sqliteTable("Channel", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  isArchived: integer("isArchived", { mode: "boolean" })
    .notNull()
    .default(false),
  createdUserId: text("createdUserId")
    .notNull()
    .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
});

export const messages = sqliteTable(
  "Message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    content: text("content").notNull(),
    isSystemMessage: integer("isSystemMessage", { mode: "boolean" })
      .notNull()
      .default(false),
    isEdited: integer("isEdited", { mode: "boolean" }).notNull().default(false),
    replyingMessageId: text("replyingMessageId"),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    channelId: text("channelId")
      .notNull()
      .references(() => channels.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    //GetHistoryのchannelId + createdAt範囲・ソートを高速化する複合インデックス
    //(channelId単独の検索もこのインデックスでカバーされる)
    index("Message_channelId_createdAt_idx").on(
      table.channelId,
      table.createdAt,
    ),
    index("Message_userId_idx").on(table.userId),
  ],
);

export const notificationDevices = sqliteTable(
  "NotificationDevice",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    token: text("token").notNull().unique(),
    platform: text("platform").notNull(),
    keys: text("keys"),
    deviceName: text("deviceName"),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastUsedAt: integer("lastUsedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("NotificationDevice_userId_idx").on(table.userId)],
);

export const notificationConfigs = sqliteTable("NotificationConfig", {
  userId: text("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  mode: text("mode").notNull().default("mention"),
});

export const passwords = sqliteTable("Password", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  password: text("password").notNull(),
  salt: text("salt").notNull(),
  userId: text("userId")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
});

export const tokens = sqliteTable(
  "Token",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().default("ログイン情報"),
    token: text("token").notNull().unique(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("Token_userId_idx").on(table.userId)],
);

export const roleLinks = sqliteTable(
  "RoleLink",
  {
    roleId: text("roleId")
      .notNull()
      .references(() => roleInfos.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    roleLinkedAt: integer("roleLinkedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index("RoleLink_userId_idx").on(table.userId),
    index("RoleLink_roleId_idx").on(table.roleId),
  ],
);

export const channelJoins = sqliteTable(
  "ChannelJoin",
  {
    channelJoinedAt: integer("channelJoinedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    channelId: text("channelId")
      .notNull()
      .references(() => channels.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.channelId] }),
    index("ChannelJoin_userId_idx").on(table.userId),
    index("ChannelJoin_channelId_idx").on(table.channelId),
  ],
);

export const channelMutes = sqliteTable(
  "ChannelMute",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    channelId: text("channelId")
      .notNull()
      .references(() => channels.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    mutedAt: integer("mutedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.channelId] }),
    index("ChannelMute_userId_idx").on(table.userId),
    index("ChannelMute_channelId_idx").on(table.channelId),
  ],
);

export const channelViewableRoles = sqliteTable(
  "ChannelViewableRole",
  {
    channelId: text("channelId")
      .notNull()
      .references(() => channels.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    roleId: text("roleId")
      .notNull()
      .references(() => roleInfos.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.roleId] }),
    index("ChannelViewableRole_roleId_idx").on(table.roleId),
    index("ChannelViewableRole_channelId_idx").on(table.channelId),
  ],
);

export const channelJoinOnDefaults = sqliteTable("ChannelJoinOnDefault", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  channelId: text("channelId")
    .notNull()
    .unique()
    .references(() => channels.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
});

export const messageUrlPreviews = sqliteTable("MessageUrlPreview", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  url: text("url").notNull(),
  type: text("type").notNull(),
  messageId: text("messageId")
    .notNull()
    .references(() => messages.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  title: text("title").notNull(),
  description: text("description"),
  faviconLink: text("faviconLink"),
  imageLink: text("imageLink"),
  videoLink: text("videoLink"),
});

export const messageReadTimes = sqliteTable(
  "MessageReadTime",
  {
    readTime: integer("readTime", { mode: "timestamp_ms" }).notNull(),
    channelId: text("channelId")
      .notNull()
      .references(() => channels.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.userId] }),
    index("MessageReadTime_userId_idx").on(table.userId),
    index("MessageReadTime_channelId_idx").on(table.channelId),
  ],
);

export const messageFileAttached = sqliteTable(
  "MessageFileAttached",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channelId")
      .notNull()
      .references(() => channels.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    actualFileName: text("actualFileName").notNull(),
    savedFileName: text("savedFileName").notNull(),
    size: integer("size").notNull(),
    type: text("type").notNull(),
    messageId: text("messageId").references(() => messages.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    index("MessageFileAttached_channelId_idx").on(table.channelId),
    index("MessageFileAttached_messageId_idx").on(table.messageId),
    index("MessageFileAttached_userId_idx").on(table.userId),
  ],
);

export const messageReactions = sqliteTable(
  "MessageReaction",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channelId")
      .notNull()
      .references(() => channels.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    emojiCode: text("emojiCode").notNull(),
    messageId: text("messageId").references(() => messages.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    reactedAt: integer("reactedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("MessageReaction_channelId_idx").on(table.channelId),
    index("MessageReaction_messageId_idx").on(table.messageId),
    index("MessageReaction_userId_idx").on(table.userId),
  ],
);

export const inboxes = sqliteTable(
  "Inbox",
  {
    type: text("type").notNull(),
    happendAt: integer("happendAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    messageId: text("messageId")
      .notNull()
      .references(() => messages.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId] }),
    index("Inbox_userId_idx").on(table.userId),
  ],
);

export const customEmojis = sqliteTable(
  "CustomEmoji",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    code: text("code").notNull().unique(),
    uploadedUserId: text("uploadedUserId")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  (table) => [index("CustomEmoji_uploadedUserId_idx").on(table.uploadedUserId)],
);

export const invitations = sqliteTable("Invitation", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  inviteCode: text("inviteCode").notNull().unique(),
  createdUserId: text("createdUserId")
    .notNull()
    .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  usedCount: integer("usedCount").notNull().default(0),
});

export const blockedIPAddresses = sqliteTable("BlockedIPAddress", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  address: text("address").notNull().unique(),
  blockedCount: integer("blockedCount").notNull().default(0),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  latestAccess: integer("latestAccess", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const serverConfigs = sqliteTable("ServerConfig", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  introduction: text("introduction").notNull(),
  RegisterAvailable: integer("RegisterAvailable", { mode: "boolean" })
    .notNull()
    .default(true),
  RegisterInviteOnly: integer("RegisterInviteOnly", { mode: "boolean" })
    .notNull()
    .default(true),
  RegisterAnnounceChannelId: text("RegisterAnnounceChannelId")
    .notNull()
    .default(""),
  MessageMaxLength: integer("MessageMaxLength").notNull().default(3000),
  MessageMaxFileSize: integer("MessageMaxFileSize").notNull().default(512000),
});

// ============================================================
// リレーション定義
// プロパティ名は schema.prisma のリレーションフィールド名と完全一致させる
// (フロントエンドがレスポンスのキー名に依存しているため)
// ============================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  Channel: many(channels),
  ChannelJoin: many(channelJoins),
  ChannelMute: many(channelMutes),
  CustomEmoji: many(customEmojis),
  Inbox: many(inboxes),
  Invitation: many(invitations),
  Message: many(messages),
  MessageFileAttached: many(messageFileAttached),
  MessageReaction: many(messageReactions),
  MessageReadTime: many(messageReadTimes),
  NotificationConfig: one(notificationConfigs, {
    fields: [users.id],
    references: [notificationConfigs.userId],
  }),
  NotificationDevice: many(notificationDevices),
  password: one(passwords, {
    fields: [users.id],
    references: [passwords.userId],
  }),
  RoleInfo: many(roleInfos),
  RoleLink: many(roleLinks),
  Token: many(tokens),
}));

export const roleInfosRelations = relations(roleInfos, ({ one, many }) => ({
  ChannelViewableRole: many(channelViewableRoles),
  user: one(users, {
    fields: [roleInfos.createdUserId],
    references: [users.id],
  }),
  RoleLink: many(roleLinks),
}));

export const channelsRelations = relations(channels, ({ one, many }) => ({
  user: one(users, {
    fields: [channels.createdUserId],
    references: [users.id],
  }),
  ChannelJoin: many(channelJoins),
  ChannelJoinOnDefault: one(channelJoinOnDefaults, {
    fields: [channels.id],
    references: [channelJoinOnDefaults.channelId],
  }),
  ChannelMute: many(channelMutes),
  ChannelViewableRole: many(channelViewableRoles),
  Message: many(messages),
  MessageFileAttached: many(messageFileAttached),
  MessageReaction: many(messageReactions),
  MessageReadTime: many(messageReadTimes),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  Inbox: many(inboxes),
  channel: one(channels, {
    fields: [messages.channelId],
    references: [channels.id],
  }),
  user: one(users, {
    fields: [messages.userId],
    references: [users.id],
  }),
  MessageFileAttached: many(messageFileAttached),
  MessageReaction: many(messageReactions),
  MessageUrlPreview: many(messageUrlPreviews),
}));

export const notificationDevicesRelations = relations(
  notificationDevices,
  ({ one }) => ({
    user: one(users, {
      fields: [notificationDevices.userId],
      references: [users.id],
    }),
  }),
);

export const notificationConfigsRelations = relations(
  notificationConfigs,
  ({ one }) => ({
    user: one(users, {
      fields: [notificationConfigs.userId],
      references: [users.id],
    }),
  }),
);

export const passwordsRelations = relations(passwords, ({ one }) => ({
  user: one(users, {
    fields: [passwords.userId],
    references: [users.id],
  }),
}));

export const tokensRelations = relations(tokens, ({ one }) => ({
  user: one(users, {
    fields: [tokens.userId],
    references: [users.id],
  }),
}));

export const roleLinksRelations = relations(roleLinks, ({ one }) => ({
  user: one(users, {
    fields: [roleLinks.userId],
    references: [users.id],
  }),
  role: one(roleInfos, {
    fields: [roleLinks.roleId],
    references: [roleInfos.id],
  }),
}));

export const channelJoinsRelations = relations(channelJoins, ({ one }) => ({
  user: one(users, {
    fields: [channelJoins.userId],
    references: [users.id],
  }),
  channel: one(channels, {
    fields: [channelJoins.channelId],
    references: [channels.id],
  }),
}));

export const channelMutesRelations = relations(channelMutes, ({ one }) => ({
  user: one(users, {
    fields: [channelMutes.userId],
    references: [users.id],
  }),
  channel: one(channels, {
    fields: [channelMutes.channelId],
    references: [channels.id],
  }),
}));

export const channelViewableRolesRelations = relations(
  channelViewableRoles,
  ({ one }) => ({
    role: one(roleInfos, {
      fields: [channelViewableRoles.roleId],
      references: [roleInfos.id],
    }),
    channel: one(channels, {
      fields: [channelViewableRoles.channelId],
      references: [channels.id],
    }),
  }),
);

export const channelJoinOnDefaultsRelations = relations(
  channelJoinOnDefaults,
  ({ one }) => ({
    channel: one(channels, {
      fields: [channelJoinOnDefaults.channelId],
      references: [channels.id],
    }),
  }),
);

export const messageUrlPreviewsRelations = relations(
  messageUrlPreviews,
  ({ one }) => ({
    message: one(messages, {
      fields: [messageUrlPreviews.messageId],
      references: [messages.id],
    }),
  }),
);

export const messageReadTimesRelations = relations(
  messageReadTimes,
  ({ one }) => ({
    user: one(users, {
      fields: [messageReadTimes.userId],
      references: [users.id],
    }),
    channel: one(channels, {
      fields: [messageReadTimes.channelId],
      references: [channels.id],
    }),
  }),
);

export const messageFileAttachedRelations = relations(
  messageFileAttached,
  ({ one }) => ({
    Message: one(messages, {
      fields: [messageFileAttached.messageId],
      references: [messages.id],
    }),
    user: one(users, {
      fields: [messageFileAttached.userId],
      references: [users.id],
    }),
    channel: one(channels, {
      fields: [messageFileAttached.channelId],
      references: [channels.id],
    }),
  }),
);

export const messageReactionsRelations = relations(
  messageReactions,
  ({ one }) => ({
    Message: one(messages, {
      fields: [messageReactions.messageId],
      references: [messages.id],
    }),
    user: one(users, {
      fields: [messageReactions.userId],
      references: [users.id],
    }),
    channel: one(channels, {
      fields: [messageReactions.channelId],
      references: [channels.id],
    }),
  }),
);

export const inboxesRelations = relations(inboxes, ({ one }) => ({
  user: one(users, {
    fields: [inboxes.userId],
    references: [users.id],
  }),
  Message: one(messages, {
    fields: [inboxes.messageId],
    references: [messages.id],
  }),
}));

export const customEmojisRelations = relations(customEmojis, ({ one }) => ({
  user: one(users, {
    fields: [customEmojis.uploadedUserId],
    references: [users.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  user: one(users, {
    fields: [invitations.createdUserId],
    references: [users.id],
  }),
}));

// ============================================================
// 型 export (prisma/generated/client の代替)
// ============================================================

export type User = typeof users.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessageUrlPreview = typeof messageUrlPreviews.$inferInsert;
