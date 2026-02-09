FROM node:25-alpine AS builder

WORKDIR /builder

COPY package*.json ./
RUN npm install --production

FROM node:25-alpine

ENV NODE_ENV=production

WORKDIR /exporter

COPY --from=builder /builder/node_modules ./node_modules
COPY . .

EXPOSE 9105

CMD ["node", "exporter.js"]