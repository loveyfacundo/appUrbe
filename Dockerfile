FROM node:22-bookworm-slim AS frontend-build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY frontend ./frontend
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY observabilidad ./observabilidad
COPY contratos ./contratos
COPY servicios ./servicios
COPY infraestructura/postgres/migrations ./infraestructura/postgres/migrations

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health/ready', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "start"]
