FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p /cache

EXPOSE 3000

CMD ["node", "--inspect=0.0.0.0:9229", "main.js", "-h", "0.0.0.0", "-p", "3000", "-c", "/cache"]
