# HERO

**HERO — Health Emergency Read Out.** Platforma karty ratunkowej dla nośników NFC **MediTag**:
opaski na rękę i breloka do kluczy.
HERO to nazwa serwisu, MediTag to nazwa produktu noszonego przez pacjenta.

Pacjent i lekarz prowadzą jedną kartę: alergie, przyjmowane leki, choroby przewlekłe, grupa krwi,
wszczepy, kontakty alarmowe. Zbliżenie telefonu do opaski albo breloka otwiera kartę bez logowania — także wtedy,
gdy pacjent jest nieprzytomny — ale w dwóch różnych zakresach: bez konta wychodzi sam zestaw
ratunkowy (bez nazwiska i kontaktów), a kartę w całości otwiera konto lekarza albo ratownika
medycznego. Każdy odczyt zostawia ślad w historii karty.

Nośnik nie przechowuje danych medycznych. Tag NFC zawiera wyłącznie adres karty — ten adres
zapisuje sama aplikacja, w zakładce „Nośniki" karty pacjenta. Jedna karta może mieć kilka nośników
naraz: opaskę na ręku, brelok przy kluczach, kartę w portfelu.

## Uruchomienie

Wymagany Node 22.13 lub nowszy: moduł `node:sqlite` istnieje od 22.5, ale do 22.12 włącznie wymaga
flagi `--experimental-sqlite`, której serwer nie ustawia. Projekt nie ma zależności z npm.

```bash
npm start          # buduje public/index.html i startuje serwer na :8080
npm run seed       # przykładowa karta HERO-2481-KX (PIN 1234) i konto lekarza (PWZ 1234567, hasło meditag123)
npm run cert       # certyfikat samopodpisany do testów po HTTPS (wymaga openssl)
npm test           # testy API, identyfikatora nośnika, kodera QR i tłumaczeń (node:test)
```

Baza powstaje w `data/hero.sqlite`; ścieżkę zmienia zmienna `HERO_DB`, port — `PORT`.

### HTTPS

Zapis nośnika i skrót PIN-u liczony przez `crypto.subtle` wymagają bezpiecznego kontekstu, a ten poza
`localhost` znaczy HTTPS. Serwer nasłuchuje po TLS-ie, gdy dostanie ścieżki do klucza i certyfikatu;
domyślny port zmienia się wtedy na 8443:

```bash
npm run cert                                                        # data/tls/{key,cert}.pem
HERO_TLS_KEY=data/tls/key.pem HERO_TLS_CERT=data/tls/cert.pem npm start
```

Certyfikat samopodpisany wystarcza do testów w sieci lokalnej — `npm run cert` wystawia go na adresy
IPv4 tego komputera i wypisuje adres do wpisania w telefonie. Telefon pokaże ostrzeżenie, które trzeba
przejść ręcznie; jeśli po jego przejściu Chrome nadal nie daje Web NFC, trzeba zainstalować `cert.pem`
w telefonie jako zaufany albo wystawić serwer przez tunel z własnym certyfikatem. Do produkcji idzie
certyfikat z urzędu na reverse proxy — patrz [Wdrożenie](#wdrożenie).

Pod TLS-em serwer dokłada `Strict-Transport-Security`. Nagłówki `Content-Security-Policy`,
`X-Content-Type-Options`, `X-Frame-Options` i `Referrer-Policy` idą z każdą odpowiedzią niezależnie od
protokołu. CSP dopuszcza styl i skrypt wstawione w plik, bo aplikacja jest jednym plikiem, ale zamyka
wszystkie źródła zewnętrzne — strona nie wysyła żadnego żądania poza własny adres.

### Z prawdziwą opaską, krok po kroku

Do zapisania nośnika potrzebny jest telefon z Androidem, Chrome i włączonym NFC. Telefon i komputer
muszą być w tej samej sieci.

1. `npm run cert` — wypisze adres **tego komputera** w sieci lokalnej. Będzie miał postać
   `https://<adres>:8443`, gdzie `<adres>` to cztery liczby wypisane przez skrypt; adresy z przykładów
   w tym pliku są cudze i nie zadziałają. Ten sam adres wypisuje serwer przy starcie. W telefonie
   wpisuje się właśnie jego, nigdy `localhost` — `localhost` w telefonie znaczy sam telefon.
2. `HERO_TLS_KEY=data/tls/key.pem HERO_TLS_CERT=data/tls/cert.pem npm start`
3. W telefonie otwórz ten adres i przejdź ostrzeżenie o certyfikacie („Zaawansowane" → „Przejdź do…").
4. „Moja karta" → „Załóż kartę": nazwisko, PIN i rodzaj nośnika. Aplikacja od razu otworzy zakładkę „Nośniki"
   z adresem tej karty i kodem QR.
5. „Zapisz na tym nośniku" → przyłóż opaskę do telefonu i przytrzymaj. „Sprawdź, co jest w nośniku"
   pokaże, co się zapisało.
6. Zablokuj ekran, zbliż opaskę: telefon otworzy kartę. Na twoim telefonie zapyta o PIN, bo ta
   przeglądarka już tę kartę otwierała; na cudzym pokaże odczyt ratunkowy bez pytania o nic.

Czysta opaska, przed zapisem, nie robi przy telefonie nic: nie ma na niej żadnego rekordu, więc nie ma
czego otworzyć — bez dźwięku, bez wibracji, bez komunikatu. Brak reakcji na nowy brelok nie znaczy, że
telefon albo brelok są zepsute. Anteny NFC w telefonach z Androidem siedzą zwykle w górnej połowie
pleców, przy aparacie, i brelok trzeba przyłożyć dokładnie tam.

Jeśli „Zapisz na tym nośniku" jest wyszarzone, powód jest jeden z trzech: strona chodzi po `http://`
zamiast `https://`, przeglądarka nie jest Chrome na Androidzie, albo moduł NFC jest wyłączony
w ustawieniach telefonu. Zostaje wtedy kod QR i zapis adresu dowolną aplikacją do NFC jako rekord
typu URL.

### Bez komputera: strona na GitHub Pages

Cała droga wyżej wymaga serwera na własnym komputerze. Do pierwszego nośnika wystarczy sam telefon,
bo `.github/workflows/strona.yml` wystawia aplikację pod adresem
<https://kajetan98.github.io/MediTagHero/> — po HTTPS, więc Chrome na Androidzie da tam Web NFC.

Wdrożenie idzie przez gałąź `gh-pages`: przepływ buduje `public/` i wypycha jej zawartość na tę
gałąź przy każdym pchnięciu do `main`. Nie przez `actions/deploy-pages`, bo token przepływu nie ma
w tym repozytorium prawa przestawić Pages na budowanie z Actions — odpowiada 403 — a do wypchnięcia
gałęzi wystarcza `contents: write`. Samo Pages włączyło się z chwilą pojawienia się gałęzi
`gh-pages`, więc nie ma tu nic do klikania w ustawieniach.

Gałąź `gh-pages` jest wynikiem budowania, nie źródłem: zmiany wprowadza się w `web/app.html`.

Pod tym adresem nie ma API HERO, więc aplikacja schodzi do trybu bez serwera: karta leży w pamięci
tej przeglądarki, która ją założyła. Do zapisania nośnika i odczytania go tym samym telefonem to
wystarcza. Karta odczytana z cudzego telefonu wymaga serwera — opaska zaprowadzi tamten telefon pod
ten sam adres, ale karty pod nim nie znajdzie.

Bez uruchomionego serwera ten sam plik działa samodzielnie: aplikacja wykrywa brak `/api/health`
i zapisuje karty w `localStorage` przeglądarki — razem ze skrótem PIN-u i historią odczytów, bo nic
nie opuszcza tej jednej przeglądarki. W tym trybie działa jako demo i jako Artifact.

## Role

| Rola | Czym się uwierzytelnia | Co może |
|---|---|---|
| Pacjent | identyfikator z nośnika + PIN | prowadzi całą kartę, widzi historię odczytów, zmienia PIN, dodaje i unieważnia nośniki, kasuje kartę |
| Lekarz | konto z numerem PWZ + identyfikator z nośnika | czyta całą kartę bez PIN-u; PIN pacjenta otwiera ten sam edytor co pacjent, bez usuwania karty; każdy jego wpis niesie nazwisko i numer PWZ |
| Ratownik medyczny | konto z numerem rejestru + identyfikator z nośnika | czyta całą kartę bez PIN-u; karty nie redaguje i nie podpisuje wpisów |
| Bez konta | sam identyfikator z nośnika | zestaw ratunkowy: grupa krwi, wiek, alergie, antykoagulanty, rozpoznania nieprzebyte, wszczepy, DNR — bez nazwiska, daty urodzenia, pozostałych leków i kontaktów |

Każda rola ma jeszcze zakładkę „Ustawienia": język interfejsu i motyw jasny albo ciemny.

Zakres bez konta wyznacza serwer, w `rescueCard` w `server/db.js`: dane, których w odpowiedzi nie ma,
nie wychodzą z bazy w ogóle, więc nie da się ich odczytać z ruchu ani z pamięci przeglądarki.
Aplikacja liczy ten sam zakres jeszcze raz w `rescueOf`, ale tylko na potrzeby trybu bez serwera;
`test/api.test.js` pilnuje, żeby te dwa opisy się nie rozeszły.

Konto zawodowe nie pyta o PIN, bo pacjent nieprzytomny go nie poda — uprawnieniem jest samo konto,
a każde otwarcie karty trafia do historii jako „dostęp lekarza" albo „dostęp ratownika", z nazwiskiem
i numerem. PIN zostaje przy edycji, i po to jest osobne wejście („Otwórz do edycji").

Token sesji konta żyje dobę od wydania: dyżur mieści się w całości, a zalogowanie zapomniane na
cudzym sprzęcie wygasa do następnego. Pierwsze użycie wygasłego tokenu kasuje go z bazy, a przycisk
„Wyloguj wszędzie" unieważnia wszystkie tokeny konta naraz.

Podpisu lekarza nie nadaje żądanie — nadaje go serwer z konta, którym uwierzytelniono zapis. Wpis
zachowuje podpis, który już ma, tylko gdy leżał z nim w bazie i nie zmienił treści: podpis dotyczy
treści, więc jej zmiana go unieważnia. Wpis nowy albo zmieniony dostaje podpis konta, którym idzie
zapis, a bez konta schodzi do „pacjent" i traci `signedBy`. Wyjątkiem jest `npm run seed`, który pisze
do bazy z pominięciem tej reguły, i tryb bez serwera, gdzie konto lekarza leży w pamięci przeglądarki
i podpis jest tylko etykietą. Ratownik medyczny wpisów nie podpisuje, bo ich nie dodaje: jego konto
otwiera kartę do odczytu, a zapis wymaga PIN-u pacjenta i konta lekarza.

Kolejność w odczycie ratunkowym jest celowa: najpierw alergie i anafilaksja, potem leki
(z wyróżnionymi antykoagulantami), choroby aktywne, wszczepy i uwagi, na końcu kontakt alarmowy.

## Ustawienia: język i motyw

Zakładka „Ustawienia" zbiera dwa wybory, oba zapamiętywane w `localStorage` tej przeglądarki i oba
z trzecim stanem „idź za urządzeniem":

| Ustawienie | Stany | Klucz | Bez wyboru |
|---|---|---|---|
| Język | jak w telefonie · Polski · English | `hero.lang.v1` | język przeglądarki |
| Motyw | jak w systemie · jasny · ciemny | `hero.theme.v1` | `prefers-color-scheme` |

Motyw ustawia atrybut `data-theme` na dokumencie; reguły obu motywów siedzą w arkuszu na górze
`web/app.html`, a jasny jest domyślny. Ten sam klucz czyta krótki skrypt w treści strony, przed
resztą aplikacji — bez niego ciemny wybór mrugnąłby jasnym tłem przy każdym otwarciu. Wydruk karty
do portfela zostaje czarno na białym niezależnie od motywu (`@media print`).

## Język: polski i angielski

Cały interfejs jest dwujęzyczny. Poza ekranem ustawień przełącznik **PL / EN** stoi też w pasku
górnym — dotknięcie go ustawia język wprost, bo kto go dotyka, chce konkretnego, nie „jak
w telefonie". Bez wyboru aplikacja bierze język przeglądarki: telefon ustawiony po angielsku otwiera
odczyt ratunkowy po angielsku, bez klikania czegokolwiek — o to w tym chodzi, bo ratownik
z zagranicy nie będzie szukał przełącznika nad nieprzytomnym pacjentem.
Zmiana języka przerysowuje bieżący ekran w miejscu: otwarta karta zostaje otwarta, a na ekranie
odczytu nie dokłada drugiego wpisu do historii.

Polski jest źródłem, angielski leży w słowniku `EN` na końcu `web/app.html`. Kluczem jest dokładny
napis polski — razem ze znacznikami, jeśli literał je niesie — więc napis bez wpisu w słowniku
zostaje po polsku, zamiast zniknąć. Napisy z wartościami w środku mają miejsca `{0}`, `{1}`, żeby
tłumaczenie mogło ustawić je w innej kolejności.

Wartości zapisane w karcie zostają po polsku, bo to dane, nie etykiety: `aktywna`, `doustnie`,
`brelok`, `dostęp lekarza`. Na ekran idą przez `t(wartość)`, a ich spis leży w `T_DANE`.

`test/i18n.test.js` pilnuje trzech rzeczy: każdy napis objęty `t()` ma wpis w słowniku, tłumaczenie
ma ten sam szkielet znaczników i te same miejsca na wartości co oryginał, a w słowniku nie ma wpisów
bez użycia. Nowy napis w kodzie bez wpisu w słowniku wywala testy — tak, żeby interfejs nie rozjechał
się na pół polski, pół angielski.

## Nośniki: opaska, brelok, karta do portfela

Jedna karta, kilka rzeczy, które do niej prowadzą. Opaska trzyma się nadgarstka i nie gubi, więc
trafia do osób starszych i do dzieci; brelok do kluczy nosi ten, kto opaski nie założy; karta do
portfela jest zapasem bez elektroniki. Wszystkie niosą ten sam adres tej samej karty i wszystkie
odczytuje się tak samo — rodzaj zmienia nazwy na ekranie i to, czego pacjent szuka, gdy jeden zginie.

Karta ma jeden adres własny (`tag_id`), ten sam przez całe jej życie, bo z nim wiąże się skrót PIN-u
(`hero:<tag>:<pin>`). Nośniki wskazują na ten adres: pierwszy powstaje razem z kartą i jest nim sam
adres własny, kolejne dokłada pacjent w zakładce „Nośniki". `GET /api/tags/:tag` mówi, do której
karty prowadzi dany identyfikator; treści karty nie oddaje.

Nośnik nosi jeden rekord NDEF typu URL: adres aplikacji z identyfikatorem w kotwicy, na przykład
`https://hero.example/#/t/HERO-2481-KX`. Trasa siedzi w kotwicy, a nie w ścieżce, bo ten sam plik
chodzi też poza serwerem HERO. Danych medycznych w nośniku nie ma.

Zapis robi sama przeglądarka, w karcie pacjenta, w zakładce „Nośniki"; zaraz po założeniu karty
aplikacja otwiera tę zakładkę, bo karta bez nośnika jest samym adresem. Obok zapisu są tam jeszcze
dwie rzeczy: sprawdzenie, co w nośniku już leży, i zabezpieczenie go przed nadpisaniem
(`makeReadOnly` — nieodwracalne).

Web NFC działa dziś w Chrome na Androidzie, wyłącznie w bezpiecznym kontekście (HTTPS albo
localhost) i po kliknięciu. Gdzie indziej — w tym na iOS — przyciski są wyłączone, a zostaje adres
do skopiowania i zapisania dowolną aplikacją do NFC jako rekord typu URL. Ratownik do odczytu żadnej
aplikacji nie potrzebuje: Android i iOS otwierają adres z nośnika same.

Obok adresu jest kod QR z tą samą treścią. Działa tam, gdzie NFC nie: na telefonie bez czytnika,
na iOS, przy wyłączonym module NFC i po wydrukowaniu. Koder siedzi w `web/app.html` (tryb bajtowy,
korekcja M, wersje 1–10, czyli do 213 bajtów) i nie ma zależności — kod powstaje jako SVG w treści
strony, więc nie wychodzi z niej żadne żądanie. Zostaje czarny na białym także w ciemnym motywie,
bo skaner czyta kontrast, nie motyw.

Po zbliżeniu nośnika otwiera się jeden adres, a zakres zależy od tego, kto go otworzył:

| Kto zbliżył | Co widzi |
|---|---|
| pacjent z otwartą sesją tej karty | swoja karta w edytorze, bez pytania o PIN |
| przeglądarka, która otwierała tę kartę PIN-em pacjenta | pytanie o PIN, potem edytor |
| zalogowane konto lekarza albo ratownika | cała karta od razu, bez pytania o PIN; otwarcie idzie do historii jako dostęp lekarza albo ratownika |
| ktokolwiek inny | zestaw ratunkowy od razu, bez pytania o cokolwiek; odczyt idzie do historii |

Rozpoznanie roli to podpowiedź z tej przeglądarki, nie uprawnienie — karty, które otwarto tu PIN-em
pacjenta, leżą w `localStorage` pod kluczem `hero.owners.v1`, a usunięcie karty je stamtąd kasuje.
Zakres i tak otwiera dopiero PIN albo konto, a zestaw ratunkowy jest jawny dla każdego, kto zna
identyfikator — z podpowiedzi albo bez niej. Rolę można przełączyć ręcznie paskiem nad kartą.

### Karta do portfela

Przycisk „Wydrukuj kartę do portfela" w tej samej zakładce składa zestaw krytyczny na jedną stronę:
czarno na białym, w kolejności z odczytu ratunkowego (alergie, leki z wyróżnionymi antykoagulantami,
choroby, wszczepy i uwagi, kontakt alarmowy), z kodem QR prowadzącym pod adres karty. To zapas na
sytuację, w której telefon pacjenta jest rozładowany, a nośnika nie ma czym odczytać. Styl `@media print`
zdejmuje z wydruku pasek górny, stopkę i przyciski.

### Zgubiony nośnik

Sam identyfikator otwiera zestaw ratunkowy, więc zgubiona opaska jest do niego kluczem dopóty, dopóki
pacjent jej nie odetnie. W zakładce „Nośniki" są na to dwie drogi:

- **unieważnienie jednego nośnika** (przycisk przy nim) — ten identyfikator przestaje oddawać kartę:
  `GET /api/cards/:tag` odpowiada 410, a nie 404, bo ratownik ze zgubioną opaską w ręku ma wiedzieć,
  że trafił na odciętą, a nie na zepsuty serwis. Karta, historia odczytów i pozostałe nośniki działają
  dalej — pacjent, który nosi opaskę i brelok, po zgubieniu opaski zostaje z czynnym brelokiem;
- **odcięcie całej karty** — to samo naraz dla wszystkich nośników. Treść karty zostaje, pacjent
  otwiera ją dalej PIN-em.

Obie operacje idą na PIN-ie karty i obu nie da się cofnąć. Nowy nośnik dodaje się w tej samej
zakładce: dostaje własny identyfikator, prowadzi do tej samej karty i nie wymaga nowego PIN-u, bo
skrót wiąże się z adresem własnym karty, nie z nośnikiem. Historia odczytów należy do karty, więc
wymiana zgubionej opaski na nową jej nie kasuje.

Bez serwera HERO karta leży w pamięci jednej przeglądarki. Nośnik zaprowadzi pod ten sam adres każdy
telefon, ale kartę znajdzie pod nim tylko ta jedna przeglądarka; nośnik, który ma zadziałać
u ratownika, wymaga serwera. Podział na zestaw ratunkowy i całą kartę w tym trybie tylko pokazuje
zakresy: dane leżą w `localStorage` tej przeglądarki, więc nie ma tam czego egzekwować.

## Struktura

```
web/app.html      źródło aplikacji (jeden plik: style + widoki + logika)
Dockerfile        obraz serwera; .dockerignore trzyma poza nim bazę, testy i dokumentację
tools/build.mjs   opakowuje web/app.html w public/index.html
tools/cert.mjs    certyfikat samopodpisany do testów po HTTPS (npm run cert)
public/           artefakt builda, serwowany przez serwer
server/index.js   serwer HTTP i routing
server/db.js      schemat SQLite, operacje na kartach i rejestr nośników
server/doctors.js konta zawodowe (lekarz, ratownik medyczny), logowanie, sesje
server/secrets.js scrypt na PIN-ach kart i hasłach kont
server/limit.js   licznik żądań w oknie czasu
server/seed.js    przykładowa karta i konto lekarza
test/api.test.js  testy API
test/nfc.test.js  identyfikator i adres nośnika (blok NFC wycięty z web/app.html)
test/qr.test.js   koder kodu QR (blok QR wycięty z web/app.html)
test/karta.test.js zawartość i kolejność odczytu ratunkowego (blok KARTA)
test/i18n.test.js pokrycie słownika angielskiego
test/ustawienia.test.js wybór języka i motywu, komplet zmiennych obu motywów
.github/workflows testy na każdy push i pull request (Node 22.13, 22 i 24);
                  strona.yml wystawia aplikację na GitHub Pages
deploy/           gotowe pliki wdrożenia: Render, Fly.io, docker compose z Caddym
docs/             model danych i plan rozwoju
```

`public/index.html` jest generowany — zmiany wprowadzaj w `web/app.html`, potem `npm run build`.

## API

| Metoda | Ścieżka | Uwierzytelnienie | Odpowiedź |
|---|---|---|---|
| GET | `/api/health` | — | stan usługi i liczba kart w bazie |
| GET | `/api/cards` | — | lista kart przykładowych (identyfikator, nazwisko, znacznik demo, data zmiany) |
| GET | `/api/tags/:tag` | — | do której karty prowadzi ten nośnik: `{tagId, kind, revoked, revokedAt}`, bez treści karty |
| GET | `/api/cards/:tag` | — albo nagłówek `x-hero-doctor` | `:tag` to identyfikator dowolnego nośnika tej karty. Bez konta: zestaw ratunkowy (`rescue: true`) i rodzaj użytego nośnika; z kontem zawodowym: cała karta z historią odczytów i listą nośników, a otwarcie idzie do historii. Skrótu PIN-u nie oddaje nigdy; unieważniony nośnik oddaje 410 |
| POST | `/api/cards/:tag/session` | `{digest}` | pełna karta z historią odczytów |
| PUT | `/api/cards/:tag` | nagłówek `x-hero-pin` | zapis karty; gdy karty nie ma w bazie, tworzy ją na podstawie `pinHash` (bez znacznika demo), razem z pierwszym nośnikiem z pola `carrier` |
| DELETE | `/api/cards/:tag` | nagłówek `x-hero-pin` | usuwa kartę i jej historię |
| POST | `/api/cards/:tag/pin` | nagłówek `x-hero-pin` + `{pinHash}` | zmienia PIN; karta, historia i opaska zostają |
| POST | `/api/cards/:tag/reads` | — dla odczytu ratunkowego, `x-hero-doctor` dla dostępu lekarza i ratownika | zapisuje odczyt; czas, identyfikator i kontekst nadaje serwer, przy koncie zawodowym także opis czytnika |
| POST | `/api/cards/:tag/revoke` | nagłówek `x-hero-pin` | odcina całą kartę: żaden nośnik nie oddaje jej już do odczytu, treść karty zostaje |
| POST | `/api/cards/:tag/carriers` | nagłówek `x-hero-pin` + `{tagId, kind, label}` | dodaje nośnik prowadzący do tej karty; oddaje listę nośników |
| DELETE | `/api/cards/:tag/carriers/:nosnik` | nagłówek `x-hero-pin` | unieważnia jeden nośnik; karta i pozostałe zostają |
| POST | `/api/doctors` | — | zakłada konto zawodowe (`pwz`, `name`, `password`, `role`: `lekarz` albo `ratownik`) |
| POST | `/api/doctors/session` | `{pwz, password}` | loguje; zwraca token sesji |
| GET | `/api/doctors/me` | nagłówek `x-hero-doctor` | konto z tokenu wraz z liczbą zalogowanych urządzeń |
| DELETE | `/api/doctors/session` | nagłówek `x-hero-doctor` | wylogowuje to urządzenie |
| DELETE | `/api/doctors/sessions` | nagłówek `x-hero-doctor` | wylogowuje konto ze wszystkich urządzeń |

Endpointy oznaczone „—" nie sprawdzają niczego poza poprawnością identyfikatora nośnika: zestaw
ratunkowy pobiera każdy, kto zna identyfikator, i każdy może dopisać wpis do historii odczytów. Karty zwykłej
nie da się jednak wyszukać — `GET /api/cards` oddaje wyłącznie karty z `demo = 1`, a ten znacznik
nadaje tylko `npm run seed`, bo żądanie HTTP go nie ustawia. `GET /api/health` podaje samą liczbę
kart w bazie, bez identyfikatorów.

Dwa liczniki w `server/limit.js` (oba w pamięci procesu, oba odpowiadają 429 po przekroczeniu): zapis
odczytu — 30 żądań na minutę z jednego adresu; próby PIN-u — 10 nieudanych na 15 minut, liczone
osobno dla pary adres–opaska, a poprawny PIN kasuje licznik. Nieudane logowania do konta zawodowego liczy ten sam
licznik, na osobnym kluczu. Blokada obejmuje wszystkie ścieżki z PIN-em: sesję, zapis, zmianę PIN-u,
odcięcie karty, operacje na nośnikach i usunięcie karty. Za reverse proxy serwer widzi adres proxy,
więc limit trzeba postawić także tam.

`GET /api/cards/:tag` bez konta oddaje sam zestaw ratunkowy: zawęża go serwer, w `rescueCard`
w `server/db.js`. Z kontem zawodowym oddaje kartę w całości, także rozpoznania ze statusem `przebyta`;
wtedy jeszcze jedno zawężenie robi przeglądarka — `critical()` zdejmuje przebyte z ekranu odczytu.
Kolejność wpisów i zawartość odczytu leżą w bloku `KARTA` w `web/app.html`, a `test/karta.test.js`
sprawdza je bez przeglądarki.

Przeglądarka nie wysyła PIN-u. Liczy `SHA-256("hero:<tag>:<pin>")`, a serwer przepuszcza ten skrót
jeszcze raz przez scrypt z losową solą. Gdy `crypto.subtle` jest niedostępne — a jest tylko
w bezpiecznym kontekście, więc nie pod zwykłym `http://` spoza localhost — aplikacja schodzi do
skrótu djb2, który nie jest funkcją kryptograficzną. Do produkcji potrzebny jest TLS, nie ten zapas.

## Czego ten kod jeszcze nie robi

Stan na dziś to działający prototyp, nie system produkcyjny. Przed wdrożeniem trzeba domknąć:

- **Zestaw ratunkowy jest jawny dla każdego, kto zna identyfikator z nośnika.** To świadoma decyzja
  produktowa: ratownik nie ma czasu na logowanie. Dlatego bez konta nie wychodzą dane, które wskazują
  osobę — nazwisko, data urodzenia, kontakty alarmowe — a identyfikator nowej karty niesie 128 bitów
  losowości, a zgubiony nośnik da się unieważnić osobno, bez ruszania pozostałych. Zostaje to, że formatu
  identyfikatora serwer nie wymusza: bierze każdy pasujący do `TAG`, bo karty założone wcześniej
  i karta przykładowa z seeda mają identyfikatory krótkie.
- **Numer zawodowy nie jest weryfikowany — to dziś najsłabsze miejsce dostępu do całej karty.**
  Sprawdzamy sam format: siedem cyfr u lekarza, od czterech do dwudziestu znaków u ratownika. Nie
  liczymy cyfry kontrolnej PWZ i nie odpytujemy rejestru Naczelnej Izby Lekarskiej ani rejestru
  ratowników medycznych, więc konto zakłada każdy, kto wpisze numer w dobrym formacie. Konto otwiera
  kartę w całości, więc przed wdrożeniem trzeba tu postawić weryfikację w rejestrze — przez podmiot
  zatrudniający albo przez węzeł krajowy. Do tego czasu jedynym śladem nadużycia jest historia
  odczytów, którą pacjent widzi w swojej karcie.
- **Zapis nośnika działa tylko w Chrome na Androidzie.** Web NFC nie istnieje w Safari ani w żadnej
  przeglądarce na iOS, więc pacjent z iPhone'em musi zapisać adres osobną aplikacją do NFC. Odczytu
  to nie dotyczy — adres z nośnika otwierają oba systemy.
- **Opis czytnika przy odczycie ratunkowym jest deklaracją.** Kontekst wpisu nadaje serwer, a przy
  dostępie kontem zawodowym opis bierze się z konta. Przy odczycie ratunkowym pole „kto odczytał" nadal
  wypełnia klient: historia dowodzi, że ktoś sięgnął po kartę, nie tego, kto to był.
- **Licznik prób żyje w pamięci procesu.** Restart serwera go zeruje, a przy kilku instancjach każda
  liczy osobno. Za reverse proxy dochodzi to, że serwer widzi adres proxy zamiast klienta, więc limit
  musi stać także w proxy (przykład w [Wdrożeniu](#wdrożenie)).
- **Skrót PIN-u siedzi w `sessionStorage`** na czas sesji przeglądarki.
- **RODO.** Dane o zdrowiu to szczególna kategoria danych osobowych (art. 9 RODO). Przed produkcją:
  ocena skutków dla ochrony danych, szyfrowanie bazy w spoczynku, retencja i eksport danych,
  umowy powierzenia przetwarzania.

## Wdrożenie

Serwer to jeden proces Node i plik SQLite obok niego; zależności z npm nie ma żadnych. TLS kończy
się na reverse proxy — serwer umie HTTPS sam (patrz [HTTPS](#https)), ale certyfikat z urzędu,
przekierowanie z portu 80 i limit żądań wygodniej trzymać w proxy.

Gotowe pliki dla trzech dróg leżą w [`deploy/`](deploy/README.md): Render (jedyna droga, którą da się
przejść z samego telefonu), Fly.io (wymaga `flyctl`, więc komputera) i własny serwer na docker compose
z Caddym. `deploy/README.md` mówi, co kiedy wybrać i co skopiować. Sekcje niżej opisują to samo od
strony pojedynczych narzędzi.

### Kontener

```bash
docker build -t hero .
docker run -d --name hero -p 127.0.0.1:8080:8080 -v hero-data:/data --restart unless-stopped hero
```

`public/index.html` powstaje przy budowaniu obrazu, więc kontener nie zapisuje nic w katalogu
aplikacji. Baza leży w wolumenie (`/data/hero.sqlite`), bo bez `-v` zniknęłaby razem z kontenerem.
Proces chodzi bez roota, a `HEALTHCHECK` odpytuje `/api/health`. Kartę przykładową w świeżej bazie
zakłada `docker exec hero node --no-warnings server/seed.js`.

### Bez kontenera

```ini
# /etc/systemd/system/hero.service
[Unit]
Description=HERO — karta ratunkowa MediTag
After=network.target

[Service]
Type=simple
User=hero
WorkingDirectory=/opt/hero
Environment=PORT=8080
Environment=HERO_DB=/var/lib/hero/hero.sqlite
ExecStart=/usr/bin/node --no-warnings server/index.js
Restart=on-failure
StateDirectory=hero
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`ExecStart` nie buduje aplikacji, więc `npm run build` musi pójść przy wdrożeniu — inaczej serwer
odda stare `public/index.html`.

### Reverse proxy

```nginx
# w bloku http
limit_req_zone $binary_remote_addr zone=hero:10m rate=10r/s;

server {
    listen 443 ssl;
    http2 on;
    server_name hero.example;

    ssl_certificate     /etc/letsencrypt/live/hero.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hero.example/privkey.pem;

    # Serwer widzi adres proxy, nie klienta, więc jego własny limit tu nie wystarcza.
    limit_req zone=hero burst=20 nodelay;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name hero.example;
    return 301 https://$host$request_uri;
}
```

W Caddym to samo mieści się w trzech wierszach i samo bierze certyfikat:

```caddy
hero.example {
    reverse_proxy 127.0.0.1:8080
}
```

Serwer nie czyta `X-Forwarded-For` — liczniki z `server/limit.js` widzą adres proxy, więc za proxy
liczą wszystkich razem. To dlatego limit musi stać także w proxy.

### Kopia zapasowa

Baza chodzi w trybie WAL, więc kopiowanie samego pliku przy działającym serwerze potrafi dać kopię
niespójną. Do kopii idzie polecenie SQLite albo zatrzymanie usługi na czas kopiowania:

```bash
sqlite3 /var/lib/hero/hero.sqlite ".backup '/var/backups/hero-$(date +%F).sqlite'"
```

Dane o zdrowiu to szczególna kategoria danych osobowych, więc kopie wymagają szyfrowania i terminu
ważności na równi z bazą. Patrz punkt o RODO w [planie rozwoju](docs/plan-rozwoju.md).

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
