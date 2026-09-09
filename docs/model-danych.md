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
  updated_by TEXT                -- 'pacjent' | 'lekarz' | 'przykład'
)

reads (
  id     TEXT PRIMARY KEY,
  tag_id TEXT REFERENCES cards(tag_id) ON DELETE CASCADE,
  at     TEXT,   -- czas nadany przez serwer, nie przez klienta
  "by"   TEXT,   -- opis czytnika, np. "ZRM P-12"; przy dostępie lekarza z jego konta
  ctx    TEXT    -- 'odczyt ratunkowy' | 'dostęp lekarza'
)

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
potwierdził", a przy lekarzu wiedzieć który. Oba pola ustawia serwer przy zapisie, na podstawie tokenu
sesji lekarza — nigdy formularz. Reguła jest prosta: nowy wpis dostaje podpis tylko wtedy, gdy zapis
idzie z konta lekarza, a podpis wpisu już zapisanego zostaje nienaruszony, także dla innego lekarza.
Zmiana treści nie przenosi podpisu: należy on do tego, kto wpis utworzył.

Bez serwera reguły nie ma czym egzekwować. W trybie przeglądarkowym konto lekarza leży w `localStorage`
pod kluczem `hero.doctors.v1`, a podpis jest etykietą, nie dowodem.

**`severity` i `anticoag` to pola sterujące widokiem.** Alergia od 3 w górę i każdy antykoagulant
trafiają do paska flag na górze odczytu ratunkowego. To jedyne miejsce, gdzie dane wpływają na układ ekranu.

**`status: "przebyta"`** wypada z odczytu ratunkowego (`critical()` po stronie przeglądarki,
zestaw jawny po stronie serwera), ale zostaje w karcie pacjenta.

**Historia odczytów nie wychodzi z zestawu jawnego.** `GET /api/cards/:tag` zwraca kartę bez `reads`
i bez `pinHash`; historia wymaga PIN-u (`POST /api/cards/:tag/session`).

**Identyfikatory wpisów nadaje przeglądarka** (`Math.random`), bo wpisy nie wychodzą poza jedną kartę.
Identyfikatory odczytów nadaje serwer (`randomUUID`), bo są dowodem dostępu.
