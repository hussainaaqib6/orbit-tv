FROM node:22-alpine
RUN apk add --no-cache ffmpeg tzdata
WORKDIR /app
COPY orbit-server.js ./
ENV PORT=8090 DATA_DIR=/data
EXPOSE 8090
VOLUME /data
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8090/api/health || exit 1
USER node
CMD ["node", "orbit-server.js"]
