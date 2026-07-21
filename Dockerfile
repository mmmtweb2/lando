# syntax=docker/dockerfile:1

# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

# Backend deps — include dev deps (typescript/tsc) even if Coolify injects
# NODE_ENV=production into the build, which would otherwise skip them.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Client deps — same: need vite + tsc (devDependencies) to build.
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci --include=dev

# Source
COPY . .

# The client build inlines VITE_* vars at build time — they MUST be provided as
# build args in Coolify (Build Variables), not just runtime env.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN cd client && npm run build

# Backend build (tsc → dist/)
RUN npm run build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production deps only (includes sharp, resend, supabase, anthropic, fal…)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Compiled backend + built client
COPY --from=build /app/dist ./dist
COPY --from=build /app/client/dist ./client/dist

# The server reads PORT from env (defaults to 3000).
EXPOSE 3000
CMD ["node", "dist/index.js"]
