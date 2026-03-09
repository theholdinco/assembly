FROM node:20-slim AS gcc-builder
ARG VITE_MAPBOX_TOKEN
WORKDIR /gcc-web
COPY gcc/web/package*.json ./
RUN npm ci
COPY gcc/web/ .
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
RUN npm run build || npx vite build

FROM node:20-slim
WORKDIR /app
COPY web/package*.json ./
RUN npm ci
COPY web/ .
COPY --from=gcc-builder /gcc-web/dist/ public/gcc/
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
