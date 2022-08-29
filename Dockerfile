FROM node:alpine

RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont

RUN addgroup -S app && adduser -S -G app app
USER app
WORKDIR /app

# get dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# copy src
COPY src/ ./

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production

CMD ["node", "server.js"]
EXPOSE 3000/tcp
