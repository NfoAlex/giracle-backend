import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";
import {cors} from "@elysiajs/cors";

import { user } from "./components/User/user.module";

export const app = new Elysia()
  .use(cors(
    {
      origin: Bun.env.CORS_ORIGIN,
    }
  ))
  .use(swagger())
  .onError(({ error, code }) => {
    if (code === "NOT_FOUND") return "Not Found :(";
    console.error(error);
  })
  .use(user)
  .listen(3000);

console.log("Server running at http://localhost:3000");
