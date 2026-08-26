# Build frontend: solo variables públicas VITE_* (CI / build-arg). Secretos nunca aquí.
FROM node:20-alpine AS web-builder

WORKDIR /app

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./

ARG VITE_API_URL=

ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# Build API
FROM node:20-alpine AS api-builder

WORKDIR /api

COPY api/package.json api/package-lock.json ./
RUN npm ci

COPY api/ ./
RUN npm run build && npm prune --omit=dev

# Runtime: nginx (SPA) + Node (API). Secretos via docker compose / .env del servidor.
FROM nginx:alpine

RUN apk add --no-cache nodejs

COPY --from=web-builder /app/dist /usr/share/nginx/html
COPY --from=api-builder /api/dist /app/api/dist
COPY --from=api-builder /api/node_modules /app/api/node_modules
COPY --from=api-builder /api/package.json /app/api/package.json

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

EXPOSE 80

ENV PORT=3000

ENTRYPOINT ["/docker-entrypoint.sh"]
