
# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
# Install dependencies required for building (including devDependencies)
COPY package.json package-lock.json ./
COPY prisma ./prisma
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:6432/dummy"
ENV DIRECT_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npm ci

# Stage 2: Build the application
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG DATABASE_URL=postgresql://postgres:postgres@pgbouncer.data.svc.cluster.local:6432/appdb?schema=public
ARG DIRECT_URL=postgresql://postgres:postgres@postgres.data.svc.cluster.local:5432/appdb?schema=public
ARG RABBITMQ_URL=amqp://admin:admin@rabbitmq.data.svc.cluster.local:5672
ENV DATABASE_URL=$DATABASE_URL
ENV DIRECT_URL=$DIRECT_URL
ENV RABBITMQ_URL=$RABBITMQ_URL

# Regenerate Prisma client to ensure types are available for TS compilation
RUN npx prisma generate

# Build Next.js
RUN npm run build

# Stage 3: Setup Production Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package.json package-lock.json ./
COPY prisma ./prisma
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:6432/dummy"
ENV DIRECT_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npm ci --only=production

# Copy built assets
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
# Note: we also copy prisma folder for reference/migrations
COPY --from=builder /app/prisma ./prisma

# Expose port and start
EXPOSE 3000
CMD ["npm", "start"]
