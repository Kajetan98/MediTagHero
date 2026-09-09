# MediTag HERO

**HERO — Health Emergency Read Out.** Karta ratunkowa pacjenta dla opaski NFC MediTag.

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
i zapisuje karty w `localStorage` przeglądarki. W tym trybie działa jako demo i jako Artifact.

## Role

| Rola | Czym się uwierzytelnia | Co może |
|---|---|---|
| Pacjent | identyfikator opaski + PIN | prowadzi całą kartę, widzi historię odczytów, kasuje kartę |
| Lekarz | identyfikator opaski + PIN pacjenta | dopisuje rozpoznania, leki i alergie; jego wpisy są oznaczone jako zweryfikowane |
| Ratownik | sam identyfikator opaski | odczyt zestawu krytycznego, bez PIN-u; odczyt trafia do historii |

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
| GET | `/api/health` | — | stan usługi |
| GET | `/api/cards` | — | lista kart (identyfikator, nazwisko, data zmiany) |
| GET | `/api/cards/:tag` | — | zestaw jawny (bez PIN-u i bez historii) |
| POST | `/api/cards/:tag/session` | `{digest}` | pełna karta z historią odczytów |
| PUT | `/api/cards/:tag` | nagłówek `x-hero-pin` | zapis karty; gdy karty nie ma w bazie, tworzy ją na podstawie `pinHash` |
| DELETE | `/api/cards/:tag` | nagłówek `x-hero-pin` | usuwa kartę i jej historię |
| POST | `/api/cards/:tag/reads` | — | zapisuje odczyt; czas i identyfikator nadaje serwer |

Przeglądarka nie wysyła PIN-u. Liczy `SHA-256("hero:<tag>:<pin>")`, a serwer przepuszcza ten skrót
jeszcze raz przez scrypt z losową solą.

## Czego ten kod jeszcze nie robi

Stan na dziś to działający prototyp, nie system produkcyjny. Przed wdrożeniem trzeba domknąć:

- **Odczyt ratunkowy jest jawny dla każdego, kto zna identyfikator opaski.** To świadoma decyzja
  produktowa — ratownik nie ma czasu na logowanie — ale wymaga długiego, losowego identyfikatora
  (nie sekwencyjnego jak w przykładach) i mechanizmu unieważniania zgubionej opaski.
- **Brak kont lekarzy.** Lekarz wchodzi PIN-em pacjenta; docelowo potrzebne konta z numerem PWZ
  i osobne uprawnienia zamiast współdzielonego PIN-u.
- **Brak limitu prób PIN-u** i brak TLS po stronie serwera (zakładany reverse proxy).
- **Skrót PIN-u siedzi w `sessionStorage`** na czas sesji przeglądarki.
- **RODO.** Dane o zdrowiu to szczególna kategoria danych osobowych (art. 9 RODO). Przed produkcją:
  ocena skutków dla ochrony danych, szyfrowanie bazy w spoczynku, retencja i eksport danych,
  umowy powierzenia przetwarzania.

## Logo

W repozytorium nie ma jeszcze plików z logo. Aplikacja używa zastępczego znaku HERO (SVG w kodzie)
i odtworzonego zastępczo napisu SPACER w stopce. Wrzuć pliki do `public/logo/` — podmiana to dwa
miejsca w `web/app.html`: symbol `#i-hero` i element `.spacer-mark`.

## Licencja

MIT — patrz `LICENSE`.
