# The Conjecture app itself. No Lean in this image — it talks to one.
FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages

RUN npm ci
RUN npm run build

FROM node:22-slim AS run

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages ./packages
RUN npm ci --omit=dev --ignore-scripts

EXPOSE 4319
VOLUME /data

CMD ["node", "packages/server/dist/cli.js"]
