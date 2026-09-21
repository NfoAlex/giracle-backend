/**
 * ユーザー(Bot含む)ごとのWSインスタンス管理。
 * 通常ユーザー用ハンドラ(src/ws.ts)とBot用ハンドラ(src/external/ws.ext.ts)の両方から使う共通処理。
 * 参照形: Util.wsUserInstance.add(...)
 */

/**
 * WSインスタンスの最小インターフェース。
 * 実体はElysiaのElysiaWSだが、テストのダミーインスタンスも受け付けるため構造的に定義する。
 */
type WSInstance = {
  send: (data: string) => unknown;
  close: () => unknown;
  subscribe: (topic: string) => unknown;
  unsubscribe: (topic: string) => unknown;
};

export namespace WSUserInstance {
  /** UserId -> 接続中のWSインスタンス群(複数端末の同時接続を許容する) */
  export const instances = new Map<string, WSInstance[]>();

  /**
   * WSインスタンスマップにユーザーのインスタンスを新しく追加
   * @param userId
   * @param ws
   */
  export function add(userId: string, ws: WSInstance) {
    const currentInstance = instances.get(userId);
    //存在しない場合普通にset
    if (!currentInstance) {
      instances.set(userId, [ws]);
      return;
    }
    instances.set(userId, [...currentInstance, ws]);
  }

  /**
   * WSインスタンスマップからユーザーのインスタンスを削除
   * @param userId
   * @param ws
   */
  export function remove(userId: string, ws: WSInstance) {
    const currentInstance = instances.get(userId);
    //存在しない場合スルー
    if (!currentInstance) {
      return;
    }

    //インスタンス自体の同一性で削除対象を特定する(複数接続時に同一ユーザーの別インスタンスを消さないため)
    const indexToRemove = currentInstance.indexOf(ws);
    if (indexToRemove !== -1) {
      currentInstance.splice(indexToRemove, 1);
    }

    //もしインスタンスが0になったら削除
    if (instances.get(userId)?.length === 0) {
      instances.delete(userId);
    }
  }

  /**
   * 指定のユーザーIdのWSインスタンスをすべて切断する(BAN・Bot無効化時等に使用)
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
   */
  export function subscribe(userId: string, wsChannel: `${string}::${string}`) {
    const currentInstance = instances.get(userId);
    //存在しない場合スルー
    if (!currentInstance) {
      return;
    }
    for (const ws of currentInstance) {
      ws.subscribe(wsChannel);
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
    }
  }
}
