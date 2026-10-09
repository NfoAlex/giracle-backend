import CalculateReactionTotal, {
  CalculateReactionTotalBulk,
} from "./Utils/CalculateReactionTotal";
import CalculateRoleLevel from "./Utils/CalculateRoleLevel";
import CheckChannelVisibility from "./Utils/CheckChannelVisibility";
import CompareRoleLevelToRole from "./Utils/CompareRoleLevelToRole";
import EscapeLikePattern from "./Utils/EscapeLikePattern";
import FetchSafe from "./Utils/FetchSafe";
import GetUrlPreviewThumbnailFileName from "./Utils/GetUrlPreviewThumbnailFileName";
import GetUserViewableChannel from "./Utils/GetUserViewableChannel";
import GetUsersRoleLevel from "./Utils/getUsersRoleLevel";
import IsBlankString from "./Utils/isBlankString";
import ReadResponseBodyWithByteLimit from "./Utils/ReadResponseBodyWithByteLimit";
import { GetSafeFileExtension, IsSafePathId } from "./Utils/SafeString";
import SendMessageNotifications from "./Utils/SendMessageNotifications";
import SendPushNotification from "./Utils/SendPushNotification";
import SendSystemMessage from "./Utils/SendSystemMessage";
import { ValidateUrl } from "./Utils/ValidateUrl";
import { WSUserInstance } from "./Utils/WSUserInstance";

export namespace Util {
  export const calculateReactionTotal = CalculateReactionTotal;
  export const calculateReactionTotalBulk = CalculateReactionTotalBulk;
  export const calculateRoleLevel = CalculateRoleLevel;
  export const checkChannelVisibility = CheckChannelVisibility;
  export const compareRoleLevelToRole = CompareRoleLevelToRole;
  export const escapeLikePattern = EscapeLikePattern;
  export const fetchSafe = FetchSafe;
  export const validateUrl = ValidateUrl;
  export const getUserViewableChannel = GetUserViewableChannel;
  export const isBlankString = IsBlankString;
  export const sendMessageNotifications = SendMessageNotifications;
  export const sendPushNotification = SendPushNotification;
  export const sendSystemMessage = SendSystemMessage;
  export const getUsersRoleLevel = GetUsersRoleLevel;
  export const getSafeFileExtension = GetSafeFileExtension;
  export const isSafePathId = IsSafePathId;
  export const getUrlPreviewThumbnailFileName = GetUrlPreviewThumbnailFileName;
  export const readResponseBodyWithByteLimit = ReadResponseBodyWithByteLimit;
  export const wsUserInstance = WSUserInstance;
}
