import CalculateReactionTotal, {
  CalculateReactionTotalBulk,
} from "./Utils/CalculateReactionTotal";
import CalculateRoleLevel from "./Utils/CalculateRoleLevel";
import CheckChannelVisibility from "./Utils/CheckChannelVisibility";
import CompareRoleLevelToRole from "./Utils/CompareRoleLevelToRole";
import EscapeLikePattern from "./Utils/EscapeLikePattern";
import GetUserViewableChannel from "./Utils/GetUserViewableChannel";
import GetUsersRoleLevel from "./Utils/getUsersRoleLevel";
import SendPushNotification from "./Utils/SendPushNotification";
import SendSystemMessage from "./Utils/SendSystemMessage";
import CheckFileExtensionIsSafe from "./Utils/CheckFileExtensionIsSafe";

export namespace Util {
  export const calculateReactionTotal = CalculateReactionTotal;
  export const calculateReactionTotalBulk = CalculateReactionTotalBulk;
  export const calculateRoleLevel = CalculateRoleLevel;
  export const checkChannelVisibility = CheckChannelVisibility;
  export const compareRoleLevelToRole = CompareRoleLevelToRole;
  export const escapeLikePattern = EscapeLikePattern;
  export const getUserViewableChannel = GetUserViewableChannel;
  export const sendPushNotification = SendPushNotification;
  export const sendSystemMessage = SendSystemMessage;
  export const getUsersRoleLevel = GetUsersRoleLevel;
  export const checkFileExtensionIsSafe = CheckFileExtensionIsSafe;
}
