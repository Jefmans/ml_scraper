FROM mcr.microsoft.com/playwright:v1.58.2-noble

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src
COPY README.md ./

RUN mkdir -p /app/scrapes

EXPOSE 3000

ENTRYPOINT ["node", "src/main.js"]
CMD ["serve"]
