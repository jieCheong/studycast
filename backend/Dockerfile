FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Prune dev dependencies after build (keeps image smaller for prod)
RUN npm prune --omit=dev

EXPOSE 3001

CMD ["node", "dist/index.js"]