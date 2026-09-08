# syntax=docker/dockerfile:1
#
# The API. Built from the REPOSITORY ROOT, not from apps/api, because npm workspaces
# hoists dependencies to the root and @msp/api depends on @msp/shared by workspace link.
#
#   docker build -f apps/api/Dockerfile .
#
# Two targets: `development` runs nest --watch against a bind mount, `production` runs the
# compiled output with dev dependencies pruned.

# ---------------------------------------------------------------- dependencies
FROM node:24-alpine AS deps
WORKDIR /app

# Only the manifests, so this layer is cached until a dependency actually changes.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# `npm ci` needs every workspace manifest present to resolve the lockfile, which is why
# apps/web is copied here even though this image never runs it.
RUN npm ci

# ---------------------------------------------------------------------- build
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# shared first: apps/api imports it as a project reference and by workspace link.
RUN npm run build --workspace @msp/shared \
 && npm run build --workspace @msp/api

# ---------------------------------------------------------------- development
# Sources arrive via a bind mount at run time; this stage only needs the toolchain.
FROM deps AS development
WORKDIR /app
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npm run build --workspace @msp/shared
ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "@msp/api"]

# ----------------------------------------------------------------- production
#
# THIS STAGE MUST STAY LAST IN THE FILE.
#
# Render builds the final stage of the Dockerfile and its blueprint schema has no
# `dockerTarget` field, so there is no way to name the stage we want -- position IS the
# selection. A stage appended below this one becomes the deployed API silently, with a
# successful build and a green deploy.
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Not root. The API takes untrusted input by design, so the blast radius of a bug in it
# should not include the container.
USER node
EXPOSE 3000

# No shell form: PID 1 is node itself, so SIGTERM reaches it and the container stops
# promptly instead of waiting out Docker's ten-second kill timer on every deploy.
CMD ["node", "apps/api/dist/main.js"]
