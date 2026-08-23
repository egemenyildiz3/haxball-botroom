FROM node:22-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --production

COPY . .

ENV NODE_ENV=production
ENV TZ=Europe/Amsterdam

CMD ["npm", "start"]
