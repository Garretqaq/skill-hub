FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# git 是运行时依赖：应用会 clone/pull marketplace 及被监听仓库
RUN apk add --no-cache git

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

RUN mkdir -p /data

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# 运行时数据（settings.json、watched.json、marketplace 克隆、被监听仓库）落到挂载卷 /data
ENV DATA_DIR=/data
ENV MARKETPLACE_DIR=/data/marketplace

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
