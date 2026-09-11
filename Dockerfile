# Obraz serwera HERO. Projekt nie ma zależności z npm, więc nie ma czego instalować — wystarczy
# Node i źródła. Build (public/index.html) robimy przy tworzeniu obrazu, żeby kontener startował
# bez zapisu do katalogu aplikacji.
FROM node:22-alpine

# 22.13 to najstarsza wersja, w której node:sqlite działa bez flagi; obraz 22-alpine jest nowszy.
WORKDIR /app
COPY package.json ./
COPY tools ./tools
COPY web ./web
COPY server ./server
RUN node tools/build.mjs

# Baza leży poza obrazem: katalog podmontuj przy uruchomieniu, inaczej zniknie razem z kontenerem.
ENV HERO_DB=/data/hero.sqlite
ENV PORT=8080
VOLUME ["/data"]
EXPOSE 8080

# Bez roota. Użytkownik `node` jest w obrazie bazowym; katalog na bazę musi do niego należeć.
RUN mkdir -p /data && chown -R node:node /data
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "server/index.js"]
