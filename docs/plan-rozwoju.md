# Plan rozwoju

Kolejność wynika z zależności: bez trwałych identyfikatorów nie ma sensu wypuszczać opasek,
bez kont lekarzy nie ma sensu obiecywać weryfikacji wpisów.

## 1. Zamknięcie prototypu (stan obecny)

Zrobione: model karty, trzy role, odczyt ratunkowy z audytem, API na SQLite, testy.

## 2. Poprawki do zamknięcia od razu

Trzy rzeczy w obecnym kodzie przeczą temu, co obiecuje dokumentacja, i przesądzają o skuteczności
kolejnych punktów planu.

**Lista kart — zrobione.** `GET /api/cards` oddaje już tylko karty oznaczone `demo`, czyli te
założone po to, żeby demo miało co pokazać; zwykłej karty nie da się przez API wyszukać.
`GET /api/health` podaje samą liczbę kart, bez identyfikatorów. Znacznika `demo` też nie ustawia
już klient — nadaje go wyłącznie zapis z `trusted`, czyli `seed.js`. Do rozstrzygnięcia zostaje, czy
przy kontach lekarzy lista kart będzie w ogóle potrzebna.

**Podpis źródła — zrobione.** Serwer nie przyjmuje `source: "lekarz"` z żądania: wpis zachowuje
podpis tylko wtedy, gdy leżał z nim w bazie i nie zmienił treści (`server/db.js`). Podpis powstaje
wyłącznie z konta lekarza (punkt 4) i niesie jego numer PWZ.

**Ślad odczytu — częściowo zrobione.** Kontekst wpisu nadaje serwer z zamkniętej listy, dostęp
lekarza wymaga konta lekarza, żądania z jednego adresu tnie limit (30 na minutę, licznik w pamięci
procesu), a historia karty trzyma ostatnie 200 wpisów. Zostaje opis czytnika, który przy odczycie
ratunkowym nadal jest deklaracją klienta: potwierdzi go dopiero uwierzytelnienie czytnika (punkt 4).
Sam limit trzeba przenieść na wspólny magazyn, gdy serwer przestanie być jedną instancją.

## 3. Identyfikator opaski

Zrobione: identyfikator nowej karty to 128 bitów losowości w base32 Crockforda (`genTag`), adres
zapisywany w opasce ma ustalony kształt (rekord NDEF typu URL, trasa `#/t/<identyfikator>`),
a zgubioną opaskę da się unieważnić — stary adres oddaje wtedy 410 z datą unieważnienia — albo
przenieść kartę na nową opaskę jednym ruchem. Karty ze starymi, krótkimi identyfikatorami działają
dalej.

Zostaje:

- **osobny, krótki numer serwisowy** nadrukowany na opasce, do zgłoszenia zgubienia, nie do odczytu.
  Dziś unieważnia się opaskę z karty, więc pacjent musi mieć dostęp do karty; numer serwisowy
  przydaje się, gdy zgłasza utratę ktoś inny albo gdy zgłoszenie idzie poza aplikację.
- **wymuszenie długości po stronie serwera** — dziś serwer bierze każdy identyfikator pasujący do
  `TAG` (do 32 znaków), bo inaczej odciąłby karty założone wcześniej i kartę przykładową z seeda.
- **przypisanie opaski do karty jako osobna encja** (`tags`), bo jeden pacjent może mieć opaskę i kartę
  na telefonie, a opaskę wymienia się częściej niż kartę. Dziś przeniesienie robi kopię karty pod nowym
  identyfikatorem i zostawia nagrobek — działa, ale historia odczytów zostaje przy starej opasce,
  a nie przy pacjencie.

## 4. Konta lekarzy

Zrobione: konto z numerem PWZ i hasłem, logowanie tokenem sesji, podpis wpisu nadawany przez serwer
(kto, jaki numer PWZ, kiedy), dostęp lekarza w historii opisany kontem zamiast polem z formularza.

Zostaje:

- **weryfikacja numeru PWZ** — dziś sprawdzamy wyłącznie format, siedem cyfr. Do domknięcia: cyfra
  kontrolna oraz sprawdzenie w rejestrze Naczelnej Izby Lekarskiej. Obie rzeczy trzeba potwierdzić przy
  źródle, zanim zaczną odrzucać numery: błędny algorytm zablokuje prawdziwych lekarzy.
- **dostęp nadawany przez pacjenta** — kod jednorazowy z terminem ważności i możliwością odebrania,
  zamiast współdzielenia PIN-u karty.
- **cykl życia sesji** — tokeny nie wygasają i nie da się wylogować ze wszystkich urządzeń. Limit
  nieudanych prób logowania już działa, na tym samym liczniku co PIN karty.
- **historia zmian** — dziś zmiana treści podpisanego wpisu unieważnia podpis i nadaje nowy, więc
  widać ostatniego autora, ale nie poprzednich. Do rozważenia osobny dziennik zmian.

## 5. Zgodność z RODO

Dane o zdrowiu to szczególna kategoria danych osobowych (art. 9 RODO). Do zrobienia przed pierwszym
prawdziwym pacjentem: ocena skutków dla ochrony danych, podstawa przetwarzania i treść zgody,
szyfrowanie bazy w spoczynku, polityka retencji, eksport i usunięcie danych na żądanie,
umowy powierzenia z dostawcą hostingu.

Osobna decyzja: czy odczyt ratunkowy bez uwierzytelnienia da się obronić jako przetwarzanie
niezbędne do ochrony żywotnych interesów (art. 9 ust. 2 lit. c). Argument jest mocny, ale wymaga
udokumentowania i ograniczenia zakresu jawnych danych do minimum.

## 6. Aplikacja mobilna

Przeglądarka wystarczy do odczytu (Android i iOS otwierają adres z tagu NFC bez aplikacji) i do
zapisu opaski — ten robi już Web NFC w zakładce „Opaska NFC". Web NFC kończy się jednak na Chrome
na Androidzie, więc aplikacja pacjenta zostaje potrzebna dla: zapisu opaski na iOS, pracy offline,
powiadomień o odczycie karty i skanowania opakowań leków.

## 7. EPI

Zakres EPI nie jest jeszcze opisany w tym repozytorium — poniżej to, czego platforma będzie
potrzebowała, żeby obsłużyć drugie urządzenie obok MediTag, niezależnie od jego funkcji:

- rejestr typów urządzeń zamiast założenia „jedna opaska = jedna karta",
- profil odczytu na typ urządzenia: co dane urządzenie pokazuje i komu,
- wspólna warstwa kart i audytu dla wszystkich urządzeń,
- osobne pytanie do rozstrzygnięcia: czy EPI zapisuje dane własne (pomiary, telemetria), bo to
  zmienia model z „karta redagowana ręcznie" na „karta plus strumień pomiarów".

Zanim to trafi do kodu, potrzebny jest opis: co EPI mierzy lub przechowuje, kto jest odbiorcą
odczytu i czy dane trafiają do tej samej karty pacjenta.

## 8. Odczyt poza aplikacją i poza siecią

Wcześniejsze punkty zakładają, że ratownik ma działający telefon z NFC i zasięg. Każde z tych
założeń bywa fałszywe, a karta ma sens tylko wtedy, gdy da się ją odczytać:

- ~~kod QR z tym samym adresem obok tagu NFC~~ — zrobione: kod QR z adresem karty jest w zakładce
  „Opaska NFC", koder w `web/app.html`, bez zależności,
- ~~widok do druku (`@media print`)~~ — zrobione: „Wydrukuj kartę do portfela" w zakładce „Opaska NFC"
  składa zestaw krytyczny na jedną stronę, z kodem QR. Eksport do PDF robi okno drukowania przeglądarki,
  osobnego generatora nie ma,
- odczyt ratunkowy dostępny offline (service worker), bo w karetce brak zasięgu jest normą,
- wersja angielska odczytu. Model ma pole `person.langs`, ale interfejs jest wyłącznie polski —
  dotyczy to zarówno pacjenta za granicą, jak i obcokrajowca leczonego w Polsce.

Osobno: alergie, leki i rozpoznania wpisuje się dziś wolnym tekstem, a pola `atc` i `icd10`
wypełnia człowiek. Słownik podpowiadający nazwy wyłapałby literówkę w nazwie leku, której przy
odczycie ratunkowym nikt nie sprawdzi u pacjenta.

## Dług techniczny do spłacenia po drodze

- wspólny magazyn dla liczników z `server/limit.js` (dziś pamięć procesu: restart zeruje limit prób
  PIN-u, a każda instancja liczy osobno),
- ~~TLS i nagłówki bezpieczeństwa~~ — zrobione: serwer nasłuchuje po HTTPS, gdy dostanie klucz
  i certyfikat, a nagłówki (CSP, nosniff, DENY na ramki, brak referrera, HSTS pod TLS-em) idą z każdą
  odpowiedzią,
- zmiana PIN-u bez usuwania karty,
- migracje schematu (dziś `CREATE TABLE IF NOT EXISTS` przy starcie),
- wersjonowanie karty: kto i co zmienił, z możliwością cofnięcia,
- testy interfejsu. Z `web/app.html` sprawdzony jest sam adres opaski (`test/nfc.test.js` wycina
  blok `NFC:START … NFC:END` i uruchamia go bez przeglądarki); reszta logiki została bez testów,
  w tym `critical()`, która decyduje o zawartości odczytu ratunkowego,
- rozszerzenie CI poza `npm test`: dziś workflow uruchamia same testy API na trzech wersjach Node-a,
- ~~opis wdrożenia~~ — zrobione: `Dockerfile`, jednostka systemd, przykład nginx i Caddy oraz kopia
  zapasowa bazy w sekcji „Wdrożenie" w README,
- lista zależności Pythona dla `tools/logos.py` (skrypt wymaga Pillow).
