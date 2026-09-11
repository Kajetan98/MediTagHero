# HERO

**HERO — Health Emergency Read Out.** Platforma karty ratunkowej dla opaski NFC **MediTag**.
HERO to nazwa serwisu, MediTag to nazwa produktu noszonego przez pacjenta.

Pacjent i lekarz prowadzą jedną kartę: alergie, przyjmowane leki, choroby przewlekłe, grupa krwi,
wszczepy, kontakty alarmowe. Ratownik po zbliżeniu telefonu do opaski dostaje zestaw krytyczny
bez logowania — także wtedy, gdy pacjent jest nieprzytomny. Każdy odczyt zostawia ślad w historii karty.

Opaska nie przechowuje danych medycznych. Tag NFC zawiera wyłącznie adres karty — ten adres
zapisuje na opasce sama aplikacja, w zakładce „Opaska NFC" karty pacjenta.

## Uruchomienie

Wymagany Node 22.13 lub nowszy: moduł `node:sqlite` istnieje od 22.5, ale do 22.12 włącznie wymaga
flagi `--experimental-sqlite`, której serwer nie ustawia. Projekt nie ma zależności z npm.

```bash
npm start          # buduje public/index.html i startuje serwer na :8080
npm run seed       # przykładowa karta HERO-2481-KX (PIN 1234) i konto lekarza (PWZ 1234567, hasło meditag123)
npm test           # testy API (node:test)
```

Baza powstaje w `data/hero.sqlite`; ścieżkę zmienia zmienna `HERO_DB`, port — `PORT`.

Bez uruchomionego serwera ten sam plik działa samodzielnie: aplikacja wykrywa brak `/api/health`
i zapisuje karty w `localStorage` przeglądarki — razem ze skrótem PIN-u i historią odczytów, bo nic
nie opuszcza tej jednej przeglądarki. W tym trybie działa jako demo i jako Artifact.

## Role

| Rola | Czym się uwierzytelnia | Co może |
|---|---|---|
| Pacjent | identyfikator opaski + PIN | prowadzi całą kartę, widzi historię odczytów, kasuje kartę |
| Lekarz | konto z numerem PWZ + identyfikator opaski + PIN pacjenta | ten sam edytor co pacjent, bez usuwania karty; każdy jego wpis niesie nazwisko i numer PWZ |
| Ratownik | sam identyfikator opaski | odczyt zestawu krytycznego, bez PIN-u; odczyt trafia do historii |

Podpisu lekarza nie nadaje żądanie — nadaje go serwer z konta, którym uwierzytelniono zapis. Wpis
zachowuje podpis, który już ma, tylko gdy leżał z nim w bazie i nie zmienił treści: podpis dotyczy
treści, więc jej zmiana go unieważnia. Wpis nowy albo zmieniony dostaje podpis konta, którym idzie
zapis, a bez konta schodzi do „pacjent" i traci `signedBy`. Wyjątkiem jest `npm run seed`, który pisze
do bazy z pominięciem tej reguły, i tryb bez serwera, gdzie konto lekarza leży w pamięci przeglądarki
i podpis jest tylko etykietą.

Kolejność w odczycie ratunkowym jest celowa: najpierw alergie i anafilaksja, potem leki
(z wyróżnionymi antykoagulantami), choroby aktywne, wszczepy i uwagi, na końcu kontakt alarmowy.

## Opaska NFC

Opaska nosi jeden rekord NDEF typu URL: adres aplikacji z identyfikatorem karty w kotwicy, na
przykład `https://hero.example/#/t/HERO-2481-KX`. Trasa siedzi w kotwicy, a nie w ścieżce, bo ten
sam plik chodzi też poza serwerem HERO. Danych medycznych w opasce nie ma.

Zapis robi sama przeglądarka, w karcie pacjenta, w zakładce „Opaska NFC"; zaraz po założeniu karty
aplikacja otwiera tę zakładkę, bo karta bez opaski jest samym adresem. Obok zapisu są tam jeszcze
dwie rzeczy: sprawdzenie, co w opasce już leży, i zabezpieczenie jej przed nadpisaniem
(`makeReadOnly` — nieodwracalne).

Web NFC działa dziś w Chrome na Androidzie, wyłącznie w bezpiecznym kontekście (HTTPS albo
localhost) i po kliknięciu. Gdzie indziej — w tym na iOS — przyciski są wyłączone, a zostaje adres
do skopiowania i zapisania dowolną aplikacją do NFC jako rekord typu URL. Ratownik do odczytu żadnej
aplikacji nie potrzebuje: Android i iOS otwierają adres z opaski same.

Po zbliżeniu opaski otwiera się jeden adres, a zakres zależy od tego, kto go otworzył:

| Kto zbliżył | Co widzi |
|---|---|
| pacjent z otwartą sesją tej karty | swoja karta w edytorze, bez pytania o PIN |
| przeglądarka, która otwierała tę kartę PIN-em pacjenta | pytanie o PIN, potem edytor |
| zalogowane konto lekarza | pytanie o PIN pacjenta; otwarcie idzie do historii jako dostęp lekarza |
| ktokolwiek inny | odczyt ratunkowy od razu, bez pytania o cokolwiek; odczyt idzie do historii |

Rozpoznanie roli to podpowiedź z tej przeglądarki, nie uprawnienie — identyfikatory opasek, które
otwarto PIN-em pacjenta, leżą w `localStorage` pod kluczem `hero.owners.v1`, a usunięcie karty je
stamtąd kasuje. Zakres i tak otwiera dopiero PIN, a odczyt ratunkowy jest jawny dla każdego, kto zna
identyfikator opaski — z podpowiedzi albo bez niej. Rolę można przełączyć ręcznie paskiem nad kartą.

Bez serwera HERO karta leży w pamięci jednej przeglądarki. Opaska zaprowadzi pod ten sam adres każdy
telefon, ale kartę znajdzie pod nim tylko ta jedna przeglądarka; opaska, która ma zadziałać
u ratownika, wymaga serwera.

## Struktura

```
web/app.html      źródło aplikacji (jeden plik: style + widoki + logika)
tools/build.mjs   opakowuje web/app.html w public/index.html
public/           artefakt builda, serwowany przez serwer
server/index.js   serwer HTTP i routing
server/db.js      schemat SQLite i operacje na kartach
server/doctors.js konta lekarzy, logowanie, sesje
server/secrets.js scrypt na PIN-ach kart i hasłach lekarzy
server/limit.js   licznik żądań w oknie czasu
server/seed.js    przykładowa karta i konto lekarza
test/api.test.js  testy API
test/nfc.test.js  adres zapisywany w opasce (blok NFC wycięty z web/app.html)
.github/workflows testy na każdy push i pull request (Node 22.13, 22 i 24)
docs/             model danych i plan rozwoju
```

`public/index.html` jest generowany — zmiany wprowadzaj w `web/app.html`, potem `npm run build`.

## API

| Metoda | Ścieżka | Uwierzytelnienie | Odpowiedź |
|---|---|---|---|
| GET | `/api/health` | — | stan usługi i liczba kart w bazie |
| GET | `/api/cards` | — | lista kart przykładowych (identyfikator, nazwisko, znacznik demo, data zmiany) |
| GET | `/api/cards/:tag` | — | treść karty bez historii odczytów i bez skrótu PIN-u |
| POST | `/api/cards/:tag/session` | `{digest}` | pełna karta z historią odczytów |
| PUT | `/api/cards/:tag` | nagłówek `x-hero-pin` | zapis karty; gdy karty nie ma w bazie, tworzy ją na podstawie `pinHash` (bez znacznika demo) |
| DELETE | `/api/cards/:tag` | nagłówek `x-hero-pin` | usuwa kartę i jej historię |
| POST | `/api/cards/:tag/reads` | — dla odczytu ratunkowego, `x-hero-doctor` dla dostępu lekarza | zapisuje odczyt; czas, identyfikator i kontekst nadaje serwer, przy koncie lekarza także opis czytnika |
| POST | `/api/doctors` | — | zakłada konto lekarza (`pwz`, `name`, `password`) |
| POST | `/api/doctors/session` | `{pwz, password}` | loguje; zwraca token sesji |
| GET | `/api/doctors/me` | nagłówek `x-hero-doctor` | konto z tokenu |
| DELETE | `/api/doctors/session` | nagłówek `x-hero-doctor` | wylogowuje |

Endpointy oznaczone „—" nie sprawdzają niczego poza poprawnością identyfikatora opaski: treść karty
pobiera każdy, kto zna identyfikator, i każdy może dopisać wpis do historii odczytów. Karty zwykłej
nie da się jednak wyszukać — `GET /api/cards` oddaje wyłącznie karty z `demo = 1`, a ten znacznik
nadaje tylko `npm run seed`, bo żądanie HTTP go nie ustawia. `GET /api/health` podaje samą liczbę
kart w bazie, bez identyfikatorów.

Dwa liczniki w `server/limit.js` (oba w pamięci procesu, oba odpowiadają 429 po przekroczeniu): zapis
odczytu — 30 żądań na minutę z jednego adresu; próby PIN-u — 10 nieudanych na 15 minut, liczone
osobno dla pary adres–opaska, a poprawny PIN kasuje licznik. Nieudane logowania lekarza liczy ten sam
licznik, na osobnym kluczu. Blokada obejmuje wszystkie ścieżki
z PIN-em: sesję, zapis i usunięcie karty. Za reverse proxy serwer widzi adres proxy, więc limit
trzeba postawić także tam.

`GET /api/cards/:tag` oddaje kartę w całości, także rozpoznania ze statusem `przebyta`. Zawężenie do
zestawu krytycznego robi przeglądarka (`critical()` w `web/app.html`), nie serwer.

Przeglądarka nie wysyła PIN-u. Liczy `SHA-256("hero:<tag>:<pin>")`, a serwer przepuszcza ten skrót
jeszcze raz przez scrypt z losową solą. Gdy `crypto.subtle` jest niedostępne — a jest tylko
w bezpiecznym kontekście, więc nie pod zwykłym `http://` spoza localhost — aplikacja schodzi do
skrótu djb2, który nie jest funkcją kryptograficzną. Do produkcji potrzebny jest TLS, nie ten zapas.

## Czego ten kod jeszcze nie robi

Stan na dziś to działający prototyp, nie system produkcyjny. Przed wdrożeniem trzeba domknąć:

- **Odczyt ratunkowy jest jawny dla każdego, kto zna identyfikator opaski.** To świadoma decyzja
  produktowa — ratownik nie ma czasu na logowanie — ale wymaga długiego, losowego identyfikatora
  (nie sekwencyjnego jak w przykładach) i mechanizmu unieważniania zgubionej opaski.
- **Numer PWZ nie jest weryfikowany.** Sprawdzamy tylko format — siedem cyfr. Nie liczymy cyfry
  kontrolnej i nie odpytujemy rejestru Naczelnej Izby Lekarskiej, więc konto nie dowodzi uprawnień.
- **Dostęp lekarza to nadal PIN pacjenta.** Konto dokłada tożsamość i podpis, nie zmienia sposobu
  wchodzenia do karty. Docelowo pacjent nadaje dostęp osobnym kodem, z terminem ważności.
- **Zapis opaski działa tylko w Chrome na Androidzie.** Web NFC nie istnieje w Safari ani w żadnej
  przeglądarce na iOS, więc pacjent z iPhone'em musi zapisać adres osobną aplikacją do NFC. Odczytu
  to nie dotyczy — adres z opaski otwierają oba systemy.
- **Sesje lekarzy nie wygasają.**
- **Opis czytnika przy odczycie ratunkowym jest deklaracją.** Kontekst wpisu nadaje serwer, a przy
  dostępie lekarza opis bierze się z konta. Przy odczycie ratunkowym pole „kto odczytał" nadal
  wypełnia klient: historia dowodzi, że ktoś sięgnął po kartę, nie tego, kto to był.
- **Brak TLS po stronie serwera** (zakładany reverse proxy). Limit prób PIN-u działa, ale licznik
  żyje w pamięci procesu: restart serwera go zeruje, a przy kilku instancjach każda liczy osobno.
- **Skrót PIN-u siedzi w `sessionStorage`** na czas sesji przeglądarki.
- **RODO.** Dane o zdrowiu to szczególna kategoria danych osobowych (art. 9 RODO). Przed produkcją:
  ocena skutków dla ochrony danych, szyfrowanie bazy w spoczynku, retencja i eksport danych,
  umowy powierzenia przetwarzania.

## Logo

Źródła leżą w katalogu głównym: `Logo_Hero.png`, `Logo_MediTag.png`, `Logo_spacER.png`.
To kwadraty 1024×1024 z napisem na białym tle, więc do interfejsu trafiają przetworzone:

```bash
python3 tools/logos.py     # wymaga Pillow
```

Skrypt zdejmuje białe tło, przycina do napisu, robi wariant z czarnym i z białym tuszem
(czerwień SPACER zostaje w obu), zapisuje pliki do `public/logo/` i wstawia je jako data URI
do bloku `LOGOS` w `web/app.html`. Dzięki temu aplikacja zostaje jednym plikiem, a znaki
przełączają się razem z motywem. Po podmianie plików źródłowych uruchom skrypt jeszcze raz.

Znak HERO stoi w pasku górnym, MediTag na wizualizacji opaski, SPACER w stopce. Znak SPACER
w stopce jest odnośnikiem na stronę zespołu; adres jest bezwzględny (`.spacer-link` w `web/app.html`),
bo ten sam plik chodzi na stronie SPACER, na serwerze HERO i jako Artifact.

## Kroje pisma

Aplikacja używa tych samych krojów co strona SPACER: **Plus Jakarta Sans** i **Space Mono**
(licencja SIL OFL, treść w `assets/fonts/OFL-*.txt`). Pliki `.woff2` trafiają do `web/app.html`
jako data URI:

```bash
node tools/fonts.mjs
```

Wstawienie w treść, zamiast odnośnika do pliku, wynika z tego, że aplikacja jest jednym plikiem
i chodzi w trzech miejscach: na stronie SPACER pod `hero-app/`, na serwerze HERO i jako Artifact.
Ścieżka względna byłaby poprawna tylko w pierwszym z nich, a Artifact wpuszcza wyłącznie kroje
z Google Fonts. Efekt uboczny: strona nie wysyła żadnego żądania na zewnątrz.

## Licencja

MIT — patrz `LICENSE`.
