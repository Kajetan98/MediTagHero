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

**Podpis źródła — zrobione.** Serwer nie przyjmuje już `source: "lekarz"` z żądania: wpis zachowuje
podpis tylko wtedy, gdy leżał z nim w bazie i nie zmienił treści, a `updatedBy` zapisuje się jako
„pacjent" (`server/db.js`). Kosztem jest to, że podpis lekarza dziś nie powstaje — wraca razem
z kontami lekarzy (punkt 4), już jako podpis konta, nie pole w żądaniu.

**Ślad odczytu — częściowo zrobione.** Kontekst wpisu nadaje serwer z zamkniętej listy, dostęp
lekarza wymaga PIN-u karty, żądania z jednego adresu tnie limit (30 na minutę, licznik w pamięci
procesu), a historia karty trzyma ostatnie 200 wpisów. Zostaje opis czytnika, który przy odczycie
ratunkowym nadal jest deklaracją klienta: potwierdzi go dopiero uwierzytelnienie czytnika (punkt 4).
Sam limit trzeba przenieść na wspólny magazyn, gdy serwer przestanie być jedną instancją.

## 3. Identyfikator opaski

Dziś identyfikator ma postać `HERO-2481-KX` — czytelną, ale zbyt krótką i zbyt regularną, żeby
chroniła cokolwiek przed zgadywaniem. Do produkcji:

- identyfikator losowy, co najmniej 128 bitów, kodowany base32 w adresie zapisanym w tagu NFC,
- osobny, krótki numer serwisowy nadrukowany na opasce (do zgłoszenia zgubienia, nie do odczytu),
- unieważnianie: pacjent zgłasza utratę, stary adres zwraca informację o unieważnieniu zamiast karty,
- przypisanie opaski do karty jako osobna encja (`tags`), bo jeden pacjent może mieć opaskę i kartę
  na telefonie, a opaskę wymienia się częściej niż kartę.

## 4. Konta lekarzy

PIN pacjenta jako klucz lekarza to rozwiązanie na demo. Docelowo:

- konto lekarza z numerem PWZ i weryfikacją przy rejestracji,
- dostęp nadawany przez pacjenta (kod jednorazowy, ważny np. 24 h) i odwoływalny,
- podpis wpisu: kto, kiedy, jakim kontem — zamiast pola `source: "lekarz"`,
- log dostępów rozdzielony na odczyty ratunkowe i dostępy lekarskie (dziś rozróżnia je tylko `ctx`).

## 5. Zgodność z RODO

Dane o zdrowiu to szczególna kategoria danych osobowych (art. 9 RODO). Do zrobienia przed pierwszym
prawdziwym pacjentem: ocena skutków dla ochrony danych, podstawa przetwarzania i treść zgody,
szyfrowanie bazy w spoczynku, polityka retencji, eksport i usunięcie danych na żądanie,
umowy powierzenia z dostawcą hostingu.

Osobna decyzja: czy odczyt ratunkowy bez uwierzytelnienia da się obronić jako przetwarzanie
niezbędne do ochrony żywotnych interesów (art. 9 ust. 2 lit. c). Argument jest mocny, ale wymaga
udokumentowania i ograniczenia zakresu jawnych danych do minimum.

## 6. Aplikacja mobilna

Przeglądarka wystarczy do odczytu (Android i iOS otwierają adres z tagu NFC bez aplikacji).
Aplikacja pacjenta ma sens dla: zapisu tagu przy aktywacji opaski, pracy offline, powiadomień
o odczycie karty i skanowania opakowań leków.

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

- kod QR z tym samym adresem obok tagu NFC — dla telefonów bez NFC i dla sytuacji, w której
  czytnik jest wyłączony,
- widok do druku (`@media print`) i eksport karty do PDF: kartka w portfelu jako zapas przy
  rozładowanym telefonie pacjenta,
- odczyt ratunkowy dostępny offline (service worker), bo w karetce brak zasięgu jest normą,
- wersja angielska odczytu. Model ma pole `person.langs`, ale interfejs jest wyłącznie polski —
  dotyczy to zarówno pacjenta za granicą, jak i obcokrajowca leczonego w Polsce.

Osobno: alergie, leki i rozpoznania wpisuje się dziś wolnym tekstem, a pola `atc` i `icd10`
wypełnia człowiek. Słownik podpowiadający nazwy wyłapałby literówkę w nazwie leku, której przy
odczycie ratunkowym nikt nie sprawdzi u pacjenta.

## Dług techniczny do spłacenia po drodze

- wspólny magazyn dla liczników z `server/limit.js` (dziś pamięć procesu: restart zeruje limit prób
  PIN-u, a każda instancja liczy osobno),
- TLS i nagłówki bezpieczeństwa (dziś zakładany reverse proxy),
- zmiana PIN-u bez usuwania karty,
- migracje schematu (dziś `CREATE TABLE IF NOT EXISTS` przy starcie),
- wersjonowanie karty: kto i co zmienił, z możliwością cofnięcia,
- testy interfejsu. Dziś pokryte jest samo API; `web/app.html` to ponad 800 linii logiki bez
  testów, w tym `critical()`, która decyduje o zawartości odczytu ratunkowego,
- rozszerzenie CI poza `npm test`: dziś workflow uruchamia same testy API na trzech wersjach Node-a,
- opis wdrożenia: obraz kontenera i konfiguracja reverse proxy zakładanego w README,
- lista zależności Pythona dla `tools/logos.py` (skrypt wymaga Pillow).
