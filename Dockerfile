# syntax=docker/dockerfile:1

# Base image with build tools for native modules
FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++ libc6-compat

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Build the application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN npm run build

# Production runner
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production

# Create data directory for SQLite persistence
RUN mkdir -p /codegem/data && chown -R node:node /codegem/data

# Copy standalone build output
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy WASM files for tree-sitter (if used client-side)
COPY --from=builder /app/public/wasm ./public/wasm

USER node
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
