FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production
ENV MINIAPP_BACKEND_HOST=0.0.0.0
ENV MINIAPP_DB_PATH=/data/miniapp.sqlite
ENV MINIAPP_UPLOAD_ROOT=/data/uploads
ENV MINIAPP_TEMPLATE_SOURCE=github

COPY ["miniapp-backend", "./miniapp-backend"]
COPY ["ima ima queencard", "./ima ima queencard"]

WORKDIR /app/miniapp-backend

EXPOSE 8080

CMD ["node", "src/server.js"]
