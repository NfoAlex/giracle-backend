import CalculateReactionTotal from "./Utils/CalculateReactionTotal";
import CalculateRoleLevel from "./Utils/CalculateRoleLevel";
import CheckChannelVisibility from "./Utils/CheckChannelVisitiblity";
import CompareRoleLevelToRole from "./Utils/CompareRoleLevelToRole";
import GetUserViewableChannel from "./Utils/GetUserViewableChannel";
import SendPushNotification from "./Utils/SendPushNotification";
import SendSystemMessage from "./Utils/SendSystemMessage";
import GetUsersRoleLevel from "./Utils/getUsersRoleLevel";

export namespace Util {
  export const calculateReactionTotal = CalculateReactionTotal;
  export const calculateRoleLevel = CalculateRoleLevel;
  export const checkChannelVisibility = CheckChannelVisibility;
  export const compareRoleLevelToRole = CompareRoleLevelToRole;
  export const getUserViewableChannel = GetUserViewableChannel;
  export const sendPushNotification = SendPushNotification;
  export const sendSystemMessage = SendSystemMessage;
  export const getUsersRoleLevel = GetUsersRoleLevel;
}
