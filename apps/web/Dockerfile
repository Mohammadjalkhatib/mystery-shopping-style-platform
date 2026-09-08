# syntax=docker/dockerfile:1
#
# The web app. Built from the REPOSITORY ROOT for the same workspace reason as the API.
#
#   docker build -f apps/web/Dockerfile .

# ---------------------------------------------------------------- dependencies
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci

# ---------------------------------------------------------------- development
FROM deps AS development
WORKDIR /app
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN npm run build --workspace @msp/shared
ENV NODE_ENV=development
EXPOSE 5173
# --host binds every interface: without it Vite listens on localhost INSIDE the container
# and the published port answers nothing.
CMD ["npm", "run", "dev", "--workspace", "@msp/web", "--", "--host"]

# ---------------------------------------------------------------------- build
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Vite inlines env at BUILD time, so the API URL has to be known here rather than at run
# time. That is a real constraint of a static build, not an oversight: changing it means
# rebuilding the image.
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build --workspace @msp/shared \
 && npm run build --workspace @msp/web

# ----------------------------------------------------------------- production
FROM nginx:1.29-alpine AS production
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
