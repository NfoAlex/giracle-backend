//名前系フィールド(ユーザー名/ロール名/チャンネル名/セッション名)の上限。
//DB側はTEXTで無制限なのでAPI層で縛る。未設定だと16MBの本文がWSで全接続へ増幅配信される
export const NAME_MAX_LENGTH = 64;
