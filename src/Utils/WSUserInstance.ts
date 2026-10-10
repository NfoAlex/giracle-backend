/**
 * ユーザーごとのWSインスタンス管理。
 * 通常ユーザー用ハンドラ(src/ws.ts)から使う共通処理。
 * 参照形: Util.wsUserInstance.add(...)
 */

/**
 * WSインスタンスの最小インターフェース。
 * 実体はElysiaのElysiaWSだが、テストのダミーインスタンスも受け付けるため構造的に定義する。
 */
type TWebSocketInstance = {
  send: (data: string) => unknown;
  close: () => unknown;
  subscribe: (topic: string) => unknown;
  unsubscribe: (topic: string) => unknown;
  /** ElysiaWSが持つ生のServerWebSocket。open/closeでラッパーが作り直されるため同一性判定に使う（テストのダミーは未定義でよい） */
  raw?: unknown;
};

export namespace WSUserInstance {
  /** UserId -> 接続中のWSインスタンス群(複数端末の同時接続を許容する) */
  export const instances = new Map<string, TWebSocketInstance[]>();

  /**
   * WSインスタンスマップにユーザーのインスタンスを新しく追加
   * @param userId
   * @param ws
   */
  export function add(userId: string, ws: TWebSocketInstance) {
    const currentInstance = instances.get(userId);
    //存在しない場合普通にset、あれば末尾に追加
    if (currentInstance) {
      currentInstance.push(ws);
      return;
    }
    instances.set(userId, [ws]);
  }

  /**
   * WSインスタンスマップからユーザーのインスタンスを削除
   * @param userId
   * @param ws
   */
  export function remove(userId: string, ws: TWebSocketInstance) {
    const currentInstance = instances.get(userId);
    //存在しない場合スルー
    if (!currentInstance) {
      return;
    }

    const indexToRemove = currentInstance.findIndex(
      (instance) =>
        instance === ws || (ws.raw !== undefined && instance.raw === ws.raw),
    );
    if (indexToRemove !== -1) {
      currentInstance.splice(indexToRemove, 1);
    }

    //もしインスタンスが0になったら削除
    if (instances.get(userId)?.length === 0) {
      instances.delete(userId);
    }
  }

  /**
   * 生のWSインスタンス(raw)一致でインスタンスマップから削除する
   * close時はトークン行が消えている(サインアウト直後等)ことがあり、userIdをトークンから引けない場合があるため
   * @param ws
   * @returns 削除できた場合のuserId、見つからなければundefined
   */
  export function removeByInstance(ws: TWebSocketInstance): string | undefined {
    //rawが無いと同一性判定ができない(テストのダミー等)
    if (ws.raw === undefined) {
      return undefined;
    }
    for (const [userId, instanceList] of instances) {
      const indexToRemove = instanceList.findIndex(
        (instance) => instance.raw === ws.raw,
      );
      if (indexToRemove === -1) {
        continue;
      }
      instanceList.splice(indexToRemove, 1);
      //もしインスタンスが0になったら削除
      if (instanceList.length === 0) {
        instances.delete(userId);
      }
      return userId;
    }
    return undefined;
  }

  /**
   * 指定のユーザーIdのWSインスタンスをすべて切断する(BAN時等に使用)
   * @param userId
   * @param reason
   */
  export function disconnect(userId: string, reason = "you are banned") {
    const currentInstance = instances.get(userId);
    //存在しない場合スルー
    if (!currentInstance) {
      return;
    }
    for (const ws of currentInstance) {
      //生のWSインスタンスのため文字列で送信する
      ws.send(
        JSON.stringify({
          signal: "ERROR",
          data: reason,
        }),
      );
      ws.close();
    }
    instances.delete(userId);
  }

  /**
   * 指定のユーザーIdのWSインスタンスすべてに対し指定のWSチャンネルを購読させる
   * @param userId
   * @param wsChannel
   * @param isBot
   */
  export function subscribe(
    userId: string,
    wsChannel: `${string}::${string}`,
    isBot: boolean = false,
  ) {
    const currentInstance = instances.get(userId);
    //存在しない場合スルー
    if (!currentInstance) {
      return;
    }
    for (const ws of currentInstance) {
      const targetChannel = isBot ? `bot::${wsChannel}` : wsChannel;
      ws.subscribe(targetChannel);
    }
  }

  /**
   * 指定のユーザーIdのWSインスタンスすべてに対し指定のWSチャンネルの購読を解除させる
   * @param userId
   * @param wsChannel
   */
  export function unsubscribe(
    userId: string,
    wsChannel: `${string}::${string}`,
  ) {
    const currentInstance = instances.get(userId);
    //存在しない場合スルー
    if (!currentInstance) {
      return;
    }
    for (const ws of currentInstance) {
      ws.unsubscribe(wsChannel);
      ws.unsubscribe(`bot::${wsChannel}`); //Botを見越して両方やる
    }
  }
}
