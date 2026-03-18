# ── Stage 1: Build ──
FROM node:20-slim AS build
WORKDIR /app

# argon2 네이티브 컴파일에 필요한 빌드 도구
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# 의존성 먼저 설치 (캐시 활용)
COPY package.json package-lock.json ./
RUN npm ci

# 소스 복사 & 빌드
COPY tsconfig.json tsdown.config.ts ./
COPY src/ src/
RUN npm run build

# production 의존성만 따로 설치
RUN npm ci --omit=dev

# ── Stage 2: Runtime ──
FROM node:20-slim
WORKDIR /app

# argon2 런타임에 필요한 libstdc++
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*

# build stage에서 필요한 파일만 복사
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

# Cloud Run은 PORT 환경변수를 자동 주입 (기본 8080)
ENV PORT=8080
EXPOSE 8080

# non-root 실행
USER node

CMD ["node", "dist/index.mjs"]
