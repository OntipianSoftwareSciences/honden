FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
ENV PORT=10000
ENV HOST=0.0.0.0
EXPOSE 10000
CMD ["node", "server/index.js"]
