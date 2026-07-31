FROM node:22-slim AS deps

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@10.33.0 && pnpm install --frozen-lockfile

FROM node:22-slim AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm install -g pnpm@10.33.0 && pnpm build

FROM node:22-slim AS runner

LABEL "language"="nodejs"
LABEL "framework"="next.js"

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./

EXPOSE 8080

CMD ["node", "server.js"]
