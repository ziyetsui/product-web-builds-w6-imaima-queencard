#!/bin/zsh -l

cd "/Users/a2/Documents/landing page wechat mini program/miniapp-backend" || exit 1

export PORT=8787
export MINIAPP_BACKEND_HOST=127.0.0.1
export MINIAPP_DEV_LOGIN=1
export WECHAT_MINIAPP_APP_ID=wx-dev
export MINIAPP_AUTH_TOKEN_SECRET=change-this-dev-secret
export MINIAPP_DB_PATH=./data/miniapp.sqlite
export MINIAPP_UPLOAD_ROOT=./data/uploads
export MINIAPP_TEMPLATE_SOURCE=github
export MINIAPP_PUBLIC_ASSET_BASE_URL=http://127.0.0.1:8787
export MINIAPP_IMAGE_PROVIDER=preview

exec /Users/a2/.nvm/versions/node/v24.18.0/bin/node src/server.js
