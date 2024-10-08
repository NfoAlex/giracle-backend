import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'

import { user } from './components/User/user.module'

const app = new Elysia()
  .use(swagger())
  .onError(({ error, code }) => {
    if (code === 'NOT_FOUND') return 'Not Found :('

    console.error(error)
  })
  .use(user)
  .listen(3000)

console.log("Server running at http://localhost:3000");