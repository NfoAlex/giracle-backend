FROM oven/bun

WORKDIR /app

RUN apt-get update && apt-get install -y \
    openssl

COPY package.json .
COPY bun.lock .

RUN bun i --prod

COPY .env .
COPY src ./src
COPY drizzle ./drizzle
COPY drizzle.config.ts .
COPY tsconfig.json .

ENV NODE_ENV production

RUN bunx drizzle-kit migrate

RUN bun build \
	--compile \
	--minify-whitespace \
	--minify-syntax \
	--target bun \
	--outfile server \
	src/index.ts

EXPOSE 3000
RUN ./server