FROM node:16-alpine AS build
LABEL maintainer="vimflowy"
LABEL version="0.2.0"
ENV NPM_CONFIG_LOGLEVEL=warn
RUN npm config set progress=false
WORKDIR /app/
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN REACT_APP_SERVER_CONFIG='{"socketserver": true}' npm run build

FROM node:16-alpine
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm install --production
RUN mkdir -p /app/build
COPY --from=build /app/build/ /app/build
EXPOSE 3000
ENV DIRECTUS_STATIC_URL=
ENV DIRECTUS_STATIC_TOKEN=
ENTRYPOINT npm run startprod -- \
    --host 0.0.0.0 \
    --port 3000
