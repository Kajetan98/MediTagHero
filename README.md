# HERO

**HERO — Health Emergency Read Out.** Platforma karty ratunkowej dla opaski NFC **MediTag**.
HERO to nazwa serwisu, MediTag to nazwa produktu noszonego przez pacjenta.

Pacjent i lekarz prowadzą jedną kartę: alergie, przyjmowane leki, choroby przewlekłe, grupa krwi,
wszczepy, kontakty alarmowe. Ratownik po zbliżeniu telefonu do opaski dostaje zestaw krytyczny
bez logowania — także wtedy, gdy pacjent jest nieprzytomny. Każdy odczyt zostawia ślad w historii karty.

Opaska nie przechowuje danych medycznych. Tag NFC zawiera wyłącznie adres karty.

## Uruchomienie

Wymagany Node 22.5 lub nowszy (wbudowany moduł `node:sqlite`). Projekt nie ma zależności z npm.

```bash
npm start          # buduje public/index.html i startuje serwer na :8080
npm run seed       # dokłada przykładową kartę HERO-2481-KX (PIN 1234)
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
| Lekarz | identyfikator opaski + PIN pacjenta | ten sam edytor co pacjent, bez usuwania karty; jego wpisy dostają znacznik „zweryfikowane przez lekarza" |
| Ratownik | sam identyfikator opaski | odczyt zestawu krytycznego, bez PIN-u; odczyt trafia do historii |

Znacznik weryfikacji nadaje przeglądarka na podstawie roli, w której otwarto kartę; serwer go nie
sprawdza. Dopóki lekarz wchodzi PIN-em pacjenta, „zweryfikowane przez lekarza" znaczy tyle, że wpis
powstał w panelu lekarza — nie że stoi za nim konto z numerem PWZ.

Kolejność w odczycie ratunkowym jest celowa: najpierw alergie i anafilaksja, potem leki
(z wyróżnionymi antykoagulantami), choroby aktywne, wszczepy i uwagi, na końcu kontakt alarmowy.

## Struktura

```
web/app.html      źródło aplikacji (jeden plik: style + widoki + logika)
tools/build.mjs   opakowuje web/app.html w public/index.html
public/           artefakt builda, serwowany przez serwer
server/index.js   serwer HTTP i routing
server/db.js      schemat SQLite i operacje na kartach
server/pin.js     scrypt na skrócie PIN-u
server/seed.js    przykładowa karta
test/api.test.js  testy API
docs/             model danych i plan rozwoju
```

`public/index.html` jest generowany — zmiany wprowadzaj w `web/app.html`, potem `npm run build`.

## API

| Metoda | Ścieżka | Uwierzytelnienie | Odpowiedź |
|---|---|---|---|
| GET | `/api/health` | — | stan usługi i liczba kart w bazie |
| GET | `/api/cards` | — | lista wszystkich kart (identyfikator, nazwisko, znacznik demo, data zmiany) |
| GET | `/api/cards/:tag` | — | treść karty bez historii odczytów i bez skrótu PIN-u |
| POST | `/api/cards/:tag/session` | `{digest}` | pełna karta z historią odczytów |
| PUT | `/api/cards/:tag` | nagłówek `x-hero-pin` | zapis karty; gdy karty nie ma w bazie, tworzy ją na podstawie `pinHash` |
| DELETE | `/api/cards/:tag` | nagłówek `x-hero-pin` | usuwa kartę i jej historię |
| POST | `/api/cards/:tag/reads` | — | zapisuje odczyt; czas i identyfikator nadaje serwer, opis czytnika podaje klient |

Endpointy oznaczone „—" nie sprawdzają niczego poza poprawnością identyfikatora opaski: listę kart
i treść pojedynczej karty pobiera każdy, kto ma dostęp do serwera, i każdy może dopisać wpis do
historii odczytów.

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
- **Lista kart jest jawna.** `GET /api/cards` wydaje identyfikatory i nazwiska wszystkich kart bez
  uwierzytelnienia, co znosi ochronę wynikającą z długiego identyfikatora. Endpoint obsługuje tylko
  ekran startowy demo.
- **Brak kont lekarzy.** Lekarz wchodzi PIN-em pacjenta; docelowo potrzebne konta z numerem PWZ
  i osobne uprawnienia zamiast współdzielonego PIN-u. Pola `source` i `updatedBy` przychodzą dziś
  z przeglądarki, więc kto zna PIN karty, może oznaczyć wpis jako zweryfikowany przez lekarza.
- **Ślad odczytu przyjmuje każdy.** `POST /api/cards/:tag/reads` wymaga samego identyfikatora, a opis
  czytnika podaje klient. Historia dowodzi, że ktoś sięgnął po kartę, nie tego, kto to był.
- **Brak limitu prób PIN-u** i brak TLS po stronie serwera (zakładany reverse proxy).
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

## Licencja

MIT — patrz `LICENSE`.
