FROM node:22-alpine AS web
ARG WEB_CACHEBUST=0
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY apps/web ./
RUN echo "web build cachebust=$WEB_CACHEBUST" && npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY services/library/package.json services/library/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY services/library/package.json services/library/tsconfig.json ./
COPY services/library/src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-rus \
    tesseract-ocr-data-eng \
    poppler-utils \
    imagemagick
COPY services/library/package.json services/library/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=web /web/dist ./web
EXPOSE 3021
CMD ["node", "dist/index.js"]
