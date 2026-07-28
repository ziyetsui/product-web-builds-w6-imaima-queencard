FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production
ENV MINIAPP_BACKEND_HOST=0.0.0.0
ENV MINIAPP_DB_PATH=/data/miniapp.sqlite
ENV MINIAPP_UPLOAD_ROOT=/data/uploads
ENV MINIAPP_TEMPLATE_SOURCE=github
ENV MINIAPP_GITHUB_CASES_FILE=/app/template-data/xhsPromptCases.ts
ENV MINIAPP_ASSET_ROOT=/app/public

COPY ["miniapp-backend", "./miniapp-backend"]
COPY ["ima ima queencard/frontend/src/data/xhsPromptCases.ts", "./template-data/xhsPromptCases.ts"]
COPY ["ima ima queencard/frontend/public/xhs-cases", "./public/xhs-cases"]
COPY ["ima ima queencard/frontend/public/model-logos", "./public/model-logos"]
COPY ["ima-queencard-miniprogram/assets", "./public/miniapp-assets"]

WORKDIR /app/miniapp-backend

EXPOSE 8080

CMD ["node", "src/server.js"]
