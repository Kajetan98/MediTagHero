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
  demo       INTEGER,            -- 1 dla kart przykładowych; tylko te wychodzą w GET /api/cards
                                 -- ustawia je wyłącznie zapis z `trusted`, nie żądanie HTTP
  updated_at TEXT,               -- ISO 8601
  updated_by TEXT                -- 'pacjent' | 'lekarz' | 'przykład'; przysyła je klient
)

reads (
  id     TEXT PRIMARY KEY,
  tag_id TEXT REFERENCES cards(tag_id) ON DELETE CASCADE,
  at     TEXT,   -- czas nadany przez serwer, nie przez klienta
  "by"   TEXT,   -- opis czytnika, np. "ZRM P-12"
  ctx    TEXT    -- 'odczyt ratunkowy' | 'dostęp lekarza'; nadaje serwer, wartość spoza tych dwóch
                 -- schodzi do odczytu ratunkowego
)
```

### Konta lekarzy

```sql
doctors (
  id         TEXT PRIMARY KEY,
  pwz        TEXT UNIQUE,   -- numer prawa wykonywania zawodu, siedem cyfr
  name       TEXT,
  pass       TEXT,          -- scrypt$<sól>$<klucz>
  created_at TEXT
)

doctor_sessions (
  token      TEXT PRIMARY KEY,   -- losowe 24 bajty, nagłówek x-hero-doctor
  doctor_id  TEXT REFERENCES doctors(id) ON DELETE CASCADE,
  created_at TEXT
)
```

Numer PWZ sprawdzamy wyłącznie co do formatu; cyfra kontrolna i rejestr Naczelnej Izby Lekarskiej
zostają w planie rozwoju.

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
    "source": "lekarz", "note": "",                        // pacjent | lekarz
    "signedBy": { "name": "dr Tomasz Lewandowski", "pwz": "1234567", "at": "2026-02-11T09:20:00.000Z" }
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

**`source` i `signedBy` na każdym wpisie.** Ratownik musi odróżnić „pacjent tak napisał" od „lekarz to
potwierdził", a przy lekarzu wiedzieć który. Żadnego z tych pól nie nadaje klient: `upsert`
w `server/db.js` bierze podpis z konta, którym uwierzytelniono zapis (nagłówek `x-hero-doctor`).
Wpis zachowuje podpis, który już ma, tylko gdy identyczny wpis o tym samym `id` leżał z nim w bazie —
podpis dotyczy treści, więc jej zmiana go unieważnia. Wpis nowy albo zmieniony dostaje podpis konta,
którym idzie zapis, a bez konta schodzi do `source: "pacjent"` i traci `signedBy`. `updatedBy`
zapisuje się jako „lekarz" przy koncie i „pacjent" bez konta. Zapis z pominięciem tej reguły ma tylko
`seed.js` (`upsert` z `{ trusted: true }`), bo nie idzie przez HTTP.

Bez serwera reguły nie ma czym egzekwować. W trybie przeglądarkowym konto lekarza leży w `localStorage`
pod kluczem `hero.doctors.v1`, a podpis jest etykietą, nie dowodem.

W praktyce znaczy to, że podpis lekarza nie powstaje dziś w ogóle: skoro lekarz uwierzytelnia się
PIN-em pacjenta, serwer nie ma czym odróżnić jednego od drugiego. Podpis wraca razem z kontami
lekarzy (punkt 4 w `plan-rozwoju.md`) i wtedy pochodzi z konta, nie z pola w żądaniu. W trybie bez
serwera przeglądarka nadal zapisuje `source` z roli — dane nie opuszczają wtedy jednej przeglądarki
i nikt tego podpisu nie weryfikuje.

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

**Ślad odczytu ratunkowego zapisze każdy, kto zna identyfikator opaski** — inaczej nie da się go
pogodzić z odczytem bez logowania. Serwer ogranicza to z trzech stron: `ctx` bierze z zamkniętej
listy (`READ_CTX`), wpis o dostępie lekarza przyjmuje wyłącznie z PIN-em karty, a liczbę żądań
z jednego adresu tnie limit z `server/limit.js`. Historia karty trzyma ostatnie 200 wpisów, starsze
kasuje się przy zapisie. Opis czytnika (`by`) zostaje deklaracją klienta — potwierdzi go dopiero
uwierzytelnienie czytnika (punkt 4 w `plan-rozwoju.md`).

**Identyfikatory wpisów nadaje przeglądarka** (`Math.random`), bo wpisy nie wychodzą poza jedną kartę.
Identyfikatory odczytów nadaje serwer (`randomUUID`), bo są dowodem dostępu — poza trybem bez
serwera i sytuacją, w której zapis odczytu nie dochodzi; wtedy identyfikator i czas pochodzą
z przeglądarki.
