# Frontend Service - Next.js 16 with TypeScript
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install --legacy-peer-deps

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time public vars for browser bundle
ARG NEXT_PUBLIC_AUTH_API_URL=/api
ARG NEXT_PUBLIC_CHAT_API_URL=/api
ARG NEXT_PUBLIC_WS_URL=

# Set environment variables for build
ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_PUBLIC_AUTH_API_URL=$NEXT_PUBLIC_AUTH_API_URL
ENV NEXT_PUBLIC_CHAT_API_URL=$NEXT_PUBLIC_CHAT_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
