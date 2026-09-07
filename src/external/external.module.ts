import { Elysia } from "elysia";
import { extMessage } from "./components/Message/message.ext.module";

//Bot用
export const externalApi = new Elysia({ prefix: "/ext" }).use(extMessage);
