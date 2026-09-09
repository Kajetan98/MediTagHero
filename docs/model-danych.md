# Model danych

Jedna karta = jeden pacjent = jedna opaska. Wszystko poza identyfikatorem, nazwiskiem i znacznikami
czasu leży w kolumnie `data` jako JSON, żeby zmiana zakresu karty nie wymagała migracji schematu.

## Tabele

```sql
cards (
  tag_id     TEXT PRIMARY KEY,   -- identyfikator opaski, np. HERO-2481-KX
  name       TEXT,               -- zdenormalizowane na potrzeby listy
  pin        TEXT,               -- scrypt$<sól>$<klucz> ze skrótu przysłanego przez przeglądarkę
  data       TEXT,               -- JSON: person, allergies, meds, conditions, contacts
  demo       INTEGER,            -- 1 dla kart przykładowych
  updated_at TEXT,               -- ISO 8601
  updated_by TEXT                -- 'pacjent' | 'lekarz' | 'przykład'; przysyła je klient
)

reads (
  id     TEXT PRIMARY KEY,
  tag_id TEXT REFERENCES cards(tag_id) ON DELETE CASCADE,
  at     TEXT,   -- czas nadany przez serwer, nie przez klienta
  "by"   TEXT,   -- opis czytnika, np. "ZRM P-12"
  ctx    TEXT    -- 'odczyt ratunkowy' | 'dostęp lekarza'
)
```

## Karta (JSON)

```jsonc
{
  "tagId": "HERO-2481-KX",
  "person": {
    "name": "Anna Wiśniewska",
    "birthDate": "1968-03-14",
    "blood": "A",            // 0 | A | B | AB
    "rh": "+",               // + | -
    "weightKg": "72",
    "heightCm": "165",
    "langs": "pl, en",
    "devices": "Stymulator serca Medtronic, 2021",
    "note": "Trudny dostęp dożylny",
    "donor": true,           // zgoda na pobranie narządów
    "dnr": false             // zgłoszone oświadczenie DNR
  },
  "allergies": [{
    "id": "a1", "allergen": "Penicylina", "kind": "lek",   // lek | pokarm | inne
    "reaction": "Obrzęk krtani", "severity": 4,            // 1 łagodna … 4 anafilaksja
    "source": "lekarz", "note": ""                         // pacjent | lekarz
  }],
  "meds": [{
    "id": "m1", "name": "Rywaroksaban", "atc": "B01AF01",
    "dose": "20 mg", "freq": "1× dziennie", "route": "doustnie", "since": "2021-06",
    "anticoag": true,                                      // wyróżniany w odczycie ratunkowym
    "source": "lekarz", "note": ""
  }],
  "conditions": [{
    "id": "c1", "name": "Migotanie przedsionków", "icd10": "I48",
    "since": "2021", "status": "aktywna",                  // aktywna | kontrolowana | przebyta
    "source": "lekarz", "note": ""
  }],
  "contacts": [{
    "id": "k1", "name": "Marek Wiśniewski", "relation": "mąż",
    "phone": "+48 601 234 567", "primary": true
  }],
  "reads": [ { "id": "…", "at": "2026-09-09T08:13:11.000Z", "by": "ZRM S-04", "ctx": "odczyt ratunkowy" } ],
  "updatedAt": "2026-09-09T08:12:44.000Z",
  "updatedBy": "lekarz"
}
```

## Decyzje, które warto znać

**`source` na każdym wpisie.** Ratownik musi odróżnić „pacjent tak napisał" od „lekarz to potwierdził".
Wartość ustawia przeglądarka z roli, w której otwarto kartę (`renderTab` w `web/app.html`) — nie
formularz, ale też nie serwer: `upsert` w `server/db.js` zapisuje sekcje karty bez sprawdzania tego
pola, tak samo jak `updatedBy` przyjmowane z treści żądania. Kto zna PIN karty, może więc oznaczyć
dowolny wpis jako zweryfikowany przez lekarza. Przeniesienie tej decyzji na serwer to punkt 2
w `plan-rozwoju.md`; docelowo zastępuje ją podpis konta lekarza (punkt 4).

**Część pól steruje układem odczytu ratunkowego.** Do paska flag na górze trafiają: alergia
o `severity` 3 lub 4, każdy lek z `anticoag`, niepuste `person.devices`, `person.dnr`
i `person.donor`. Kolejność wpisów też wynika z danych — alergie idą malejąco po `severity`,
leki z antykoagulantami na początku. `contacts[].primary` dostaje znacznik „pierwszy".

**`status: "przebyta"`** wypada z odczytu ratunkowego, ale zostaje w karcie pacjenta. Filtruje
wyłącznie przeglądarka (`critical()`); `GET /api/cards/:tag` oddaje wszystkie rozpoznania, także
przebyte. Ekran odczytu ich nie pokaże, samo API — tak.

**Historia odczytów nie wychodzi z zestawu jawnego.** `GET /api/cards/:tag` zwraca kartę bez `reads`
i bez `pinHash`; historia wymaga PIN-u (`POST /api/cards/:tag/session`). Dotyczy to trybu z serwerem:
bez niego aplikacja czyta `localStorage`, gdzie karta leży w całości — razem ze skrótem PIN-u
i historią — bo dane nie opuszczają jednej przeglądarki.

**Ślad odczytu przyjmuje serwer od każdego.** `POST /api/cards/:tag/reads` wymaga tylko istniejącego
identyfikatora opaski, a opis czytnika (`by`) i kontekst (`ctx`) podaje klient. Wpisy w historii są
więc dowodem, że ktoś sięgnął po kartę, ale nie dowodem, kto to był.

**Identyfikatory wpisów nadaje przeglądarka** (`Math.random`), bo wpisy nie wychodzą poza jedną kartę.
Identyfikatory odczytów nadaje serwer (`randomUUID`), bo są dowodem dostępu — poza trybem bez
serwera i sytuacją, w której zapis odczytu nie dochodzi; wtedy identyfikator i czas pochodzą
z przeglądarki.
