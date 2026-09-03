import CalculateReactionTotal, {
  CalculateReactionTotalBulk,
} from "./Utils/CalculateReactionTotal";
import CalculateRoleLevel from "./Utils/CalculateRoleLevel";
import CheckChannelVisibility from "./Utils/CheckChannelVisibility";
import CompareRoleLevelToRole from "./Utils/CompareRoleLevelToRole";
import EscapeLikePattern from "./Utils/EscapeLikePattern";
import GetSafeFileExtension from "./Utils/GetSafeFileExtension";
import GetUrlPreviewThumbnailFileName from "./Utils/GetUrlPreviewThumbnailFileName";
import GetUserViewableChannel from "./Utils/GetUserViewableChannel";
import GetUsersRoleLevel from "./Utils/getUsersRoleLevel";
import SendPushNotification from "./Utils/SendPushNotification";
import SendSystemMessage from "./Utils/SendSystemMessage";
import { ValidateUrl } from "./Utils/ValidateUrl";

export namespace Util {
  export const calculateReactionTotal = CalculateReactionTotal;
  export const calculateReactionTotalBulk = CalculateReactionTotalBulk;
  export const calculateRoleLevel = CalculateRoleLevel;
  export const checkChannelVisibility = CheckChannelVisibility;
  export const compareRoleLevelToRole = CompareRoleLevelToRole;
  export const escapeLikePattern = EscapeLikePattern;
  export const validateUrl = ValidateUrl;
  export const getUserViewableChannel = GetUserViewableChannel;
  export const sendPushNotification = SendPushNotification;
  export const sendSystemMessage = SendSystemMessage;
  export const getUsersRoleLevel = GetUsersRoleLevel;
  export const getSafeFileExtension = GetSafeFileExtension;
  export const getUrlPreviewThumbnailFileName = GetUrlPreviewThumbnailFileName;
}
