# Wdrożenie HERO: co wybrać i co skopiować

Serwer HERO to jeden proces Node i plik SQLite obok niego. Zależności z npm nie ma żadnych, więc
wdrożenie sprowadza się do trzech rzeczy: uruchomić obraz z `Dockerfile`, dać mu trwały katalog na
bazę i postawić przed nim HTTPS.

HTTPS nie jest opcją. Bez niego przeglądarka nie da ani zapisu NFC (Web NFC wymaga bezpiecznego
kontekstu), ani `crypto.subtle`, z którego liczy się skrót PIN-u. Każda konfiguracja z tego katalogu
kończy się adresem `https://`.

W tym katalogu nic się samo nie wdraża — to gotowe pliki do wybranej drogi.

## Którą drogę wybrać

| Droga | Kiedy | Czego trzeba |
|---|---|---|
| [Render](#render) | chcesz wdrożyć z telefonu, bez komputera | konto Render, to repozytorium na GitHubie |
| [Fly.io](#flyio) | masz komputer i chcesz serwer w Warszawie | konto Fly, `flyctl`, komputer |
| [własny serwer](#własny-serwer-docker-compose--caddy) | masz VPS i domenę | VPS z Dockerem, domena wskazująca na niego |
| [bez serwera](#bez-serwera-github-pages) | chcesz tylko zobaczyć aplikację | nic |

Zanim wybierzesz, jedna rzecz o kosztach: na darmowych planach usługa usypia po kilkunastu minutach
bez ruchu, a pierwsze żądanie po przerwie budzi ją kilkadziesiąt sekund. Do zabawy i do testów to
nie przeszkadza. Do opaski, która ma zadziałać u ratownika, przeszkadza bardzo — tam potrzebny jest
plan bez usypiania.

## Render

Najkrótsza droga z telefonu, bo wszystko dzieje się w przeglądarce.

1. Skopiuj `deploy/render.yaml` do katalogu głównego repozytorium jako `render.yaml`
   (na telefonie: GitHub → **Add file** → **Create new file** → nazwa `render.yaml` → wklej treść).
2. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint** → wskaż to repozytorium.
3. Render czyta `render.yaml`, buduje obraz z `Dockerfile` i podłącza dysk pod `/data`.
4. Po wdrożeniu dostajesz adres `https://hero-xxxx.onrender.com`. To adres, który wchodzi do opaski.

Dysk trzyma bazę między wdrożeniami — bez niego każde wdrożenie kasowałoby wszystkie karty.
Dysku nie ma na planie `free`; `render.yaml` ustawia dlatego `plan: starter`.

## Fly.io

```bash
cp deploy/fly.toml fly.toml
fly launch --no-deploy --copy-config
fly volumes create hero_data --size 1 --region waw
fly deploy
```

Region `waw` to Warszawa — najbliżej polskiego użytkownika. `[[mounts]]` podłącza wolumen pod
`/data`, więc baza przeżywa wdrożenie. Maszyna zatrzymuje się przy braku ruchu; kto tego nie chce,
ustawia w `fly.toml` `min_machines_running = 1`.

Jedna maszyna, nie dwie: SQLite nie znosi dwóch procesów piszących do jednego pliku, a liczniki
żądań z `server/limit.js` żyją w pamięci procesu, więc przy dwóch instancjach każda liczyłaby osobno.

## Własny serwer: docker compose + Caddy

```bash
cd deploy
cp hero.env.example hero.env          # domyślne wartości wystarczą
$EDITOR Caddyfile                     # hero.example → twoja domena
docker compose up -d
```

Caddy bierze certyfikat z Let's Encrypt sam, byle domena wskazywała na ten serwer (rekord A na jego
adres IP) i porty 80 i 443 były otwarte. Aplikacja nie wystawia swojego portu na świat — ruch
wchodzi przez Caddy.

Kopia zapasowa bazy (SQLite w trybie WAL kopiuje się poprawnie tylko własnym poleceniem):

```bash
docker compose exec hero node -e "new (require('node:sqlite').DatabaseSync)(process.env.HERO_DB).exec(\"VACUUM INTO '/data/kopia.sqlite'\")"
docker compose cp hero:/data/kopia.sqlite ./kopia-$(date +%F).sqlite
```

Limit żądań przed aplikacją: `Caddyfile` go nie ma, bo `rate_limit` wymaga Caddy'ego zbudowanego
z wtyczką. Kto go chce, stawia nginx z `limit_req` (przykład w README, sekcja „Reverse proxy") albo
buduje Caddy z `caddy-ratelimit`. Liczniki w samej aplikacji działają zawsze, ale za proxy widzą
adres proxy, więc liczą wszystkich razem.

## Bez serwera: GitHub Pages

`.github/workflows/strona.yml` wystawia aplikację na GitHub Pages przy każdym pushu do `main`.
Karty leżą wtedy w pamięci przeglądarki (`localStorage`) i nie wychodzą nigdzie — opaska zaprowadzi
pod ten adres każdy telefon, ale kartę znajdzie pod nim tylko ta jedna przeglądarka, która ją
założyła. Do obejrzenia aplikacji i do zapisania opaski wystarczy; do odczytu na cudzym telefonie
nie — na to potrzebny jest serwer z jednej z dróg wyżej.

## Po wdrożeniu

1. Otwórz adres usługi w telefonie i sprawdź, czy w pasku górnym jest napis „serwer HERO"
   (nie „dane w tej przeglądarce"). Jeśli jest drugi, aplikacja nie widzi swojego API.
2. `https://<adres>/api/health` ma oddać `{"service":"hero", …}`.
3. Załóż kartę, zapisz opaskę, zbliż ją drugim telefonem. Bez konta zobaczysz zestaw ratunkowy —
   tak ma być.
4. Kartę przykładową w świeżej bazie zakłada `npm run seed`; na hostingu PaaS nie ma tego jak
   uruchomić, ale nie trzeba: własną kartę zakłada się z aplikacji.

## Czego te pliki nie rozwiązują

- **Weryfikacji kont lekarzy i ratowników w rejestrze.** Numer sprawdzamy tylko co do formatu, więc
  konto zawodowe — a z nim dostęp do całej karty — założy każdy, kto wpisze numer w dobrym
  kształcie. To dziś najsłabsze miejsce dostępu i nie da się go załatwić konfiguracją hostingu.
- **Szyfrowania bazy w spoczynku.** Plik SQLite leży na dysku otwartym tekstem. Dane o zdrowiu to
  szczególna kategoria danych osobowych (art. 9 RODO), więc przed prawdziwymi pacjentami trzeba do
  tego wrócić — razem z oceną skutków, retencją i umową powierzenia z hostingiem.
- **Kopii zapasowych na PaaS.** Render i Fly trzymają dysk, ale kopii nie robią za ciebie.
