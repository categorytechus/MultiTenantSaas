FROM node:20-alpine AS builder

# bcrypt (native module) needs a compiler toolchain on Alpine.
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npm run build

# Remove devDependencies before copying to the runtime image.
RUN npm prune --omit=dev

FROM node:20-alpine

WORKDIR /app

# Copy production dependencies + compiled output.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 4000

CMD ["node", "dist/index.js"]
