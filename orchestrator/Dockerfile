FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY index.js ./
COPY permissions.js ./
COPY utils/ ./utils/

EXPOSE 3000

CMD ["node", "index.js"]
