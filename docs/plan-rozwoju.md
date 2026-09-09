# Plan rozwoju

Kolejność wynika z zależności: bez trwałych identyfikatorów nie ma sensu wypuszczać opasek,
bez kont lekarzy nie ma sensu obiecywać weryfikacji wpisów.

## 1. Zamknięcie prototypu (stan obecny)

Zrobione: model karty, trzy role, odczyt ratunkowy z audytem, API na SQLite, testy.

## 2. Identyfikator opaski

Dziś identyfikator ma postać `HERO-2481-KX` — czytelną, ale zbyt krótką i zbyt regularną, żeby
chroniła cokolwiek przed zgadywaniem. Do produkcji:

- identyfikator losowy, co najmniej 128 bitów, kodowany base32 w adresie zapisanym w tagu NFC,
- osobny, krótki numer serwisowy nadrukowany na opasce (do zgłoszenia zgubienia, nie do odczytu),
- unieważnianie: pacjent zgłasza utratę, stary adres zwraca informację o unieważnieniu zamiast karty,
- przypisanie opaski do karty jako osobna encja (`tags`), bo jeden pacjent może mieć opaskę i kartę
  na telefonie, a opaskę wymienia się częściej niż kartę.

## 3. Konta lekarzy

PIN pacjenta jako klucz lekarza to rozwiązanie na demo. Docelowo:

- konto lekarza z numerem PWZ i weryfikacją przy rejestracji,
- dostęp nadawany przez pacjenta (kod jednorazowy, ważny np. 24 h) i odwoływalny,
- podpis wpisu: kto, kiedy, jakim kontem — zamiast pola `source: "lekarz"`,
- log dostępów rozdzielony na odczyty ratunkowe i dostępy lekarskie (dziś rozróżnia je tylko `ctx`).

## 4. Zgodność z RODO

Dane o zdrowiu to szczególna kategoria danych osobowych (art. 9 RODO). Do zrobienia przed pierwszym
prawdziwym pacjentem: ocena skutków dla ochrony danych, podstawa przetwarzania i treść zgody,
szyfrowanie bazy w spoczynku, polityka retencji, eksport i usunięcie danych na żądanie,
umowy powierzenia z dostawcą hostingu.

Osobna decyzja: czy odczyt ratunkowy bez uwierzytelnienia da się obronić jako przetwarzanie
niezbędne do ochrony żywotnych interesów (art. 9 ust. 2 lit. c). Argument jest mocny, ale wymaga
udokumentowania i ograniczenia zakresu jawnych danych do minimum.

## 5. Aplikacja mobilna

Przeglądarka wystarczy do odczytu (Android i iOS otwierają adres z tagu NFC bez aplikacji).
Aplikacja pacjenta ma sens dla: zapisu tagu przy aktywacji opaski, pracy offline, powiadomień
o odczycie karty i skanowania opakowań leków.

## 6. EPI

Zakres EPI nie jest jeszcze opisany w tym repozytorium — poniżej to, czego platforma będzie
potrzebowała, żeby obsłużyć drugie urządzenie obok MediTag, niezależnie od jego funkcji:

- rejestr typów urządzeń zamiast założenia „jedna opaska = jedna karta",
- profil odczytu na typ urządzenia: co dane urządzenie pokazuje i komu,
- wspólna warstwa kart i audytu dla wszystkich urządzeń,
- osobne pytanie do rozstrzygnięcia: czy EPI zapisuje dane własne (pomiary, telemetria), bo to
  zmienia model z „karta redagowana ręcznie" na „karta plus strumień pomiarów".

Zanim to trafi do kodu, potrzebny jest opis: co EPI mierzy lub przechowuje, kto jest odbiorcą
odczytu i czy dane trafiają do tej samej karty pacjenta.

## Dług techniczny do spłacenia po drodze

- limit prób PIN-u i limit żądań na adres IP,
- TLS i nagłówki bezpieczeństwa (dziś zakładany reverse proxy),
- zmiana PIN-u bez usuwania karty,
- migracje schematu (dziś `CREATE TABLE IF NOT EXISTS` przy starcie),
- wersjonowanie karty: kto i co zmienił, z możliwością cofnięcia.
