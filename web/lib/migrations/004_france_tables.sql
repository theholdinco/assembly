-- France procurement data tables (DECP)

CREATE TABLE IF NOT EXISTS france_contracts (
  uid                TEXT PRIMARY KEY,
  market_id          TEXT,
  buyer_siret        TEXT,
  buyer_name         TEXT,
  nature             TEXT,
  object             TEXT,
  cpv_code           TEXT,
  cpv_division       TEXT,
  procedure          TEXT,
  amount_ht          NUMERIC(18,2),
  duration_months    INTEGER,
  notification_date  DATE,
  publication_date   DATE,
  location_code      TEXT,
  location_name      TEXT,
  bids_received      INTEGER,
  form_of_price      TEXT,
  framework_id       TEXT,
  anomalies          TEXT,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS france_contracts_buyer_siret_idx       ON france_contracts (buyer_siret);
CREATE INDEX IF NOT EXISTS france_contracts_cpv_code_idx          ON france_contracts (cpv_code);
CREATE INDEX IF NOT EXISTS france_contracts_cpv_division_idx      ON france_contracts (cpv_division);
CREATE INDEX IF NOT EXISTS france_contracts_notification_date_idx ON france_contracts (notification_date);
CREATE INDEX IF NOT EXISTS france_contracts_amount_ht_idx         ON france_contracts (amount_ht);
CREATE INDEX IF NOT EXISTS france_contracts_procedure_idx         ON france_contracts (procedure);

CREATE TABLE IF NOT EXISTS france_contract_vendors (
  contract_uid  TEXT NOT NULL REFERENCES france_contracts (uid),
  vendor_id     TEXT NOT NULL,
  vendor_name   TEXT,
  PRIMARY KEY (contract_uid, vendor_id)
);

CREATE INDEX IF NOT EXISTS france_contract_vendors_vendor_id_idx ON france_contract_vendors (vendor_id);

CREATE TABLE IF NOT EXISTS france_vendors (
  id               TEXT PRIMARY KEY,
  id_type          TEXT,
  name             TEXT,
  siret            TEXT,
  siren            TEXT,
  contract_count   INTEGER DEFAULT 0,
  total_amount_ht  NUMERIC(18,2) DEFAULT 0,
  first_seen       DATE,
  last_seen        DATE,
  sirene_enriched  BOOLEAN DEFAULT FALSE,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS france_buyers (
  siret            TEXT PRIMARY KEY,
  name             TEXT,
  contract_count   INTEGER DEFAULT 0,
  total_amount_ht  NUMERIC(18,2) DEFAULT 0,
  first_seen       DATE,
  last_seen        DATE,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS france_modifications (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_uid         TEXT NOT NULL,
  modification_object  TEXT,
  new_amount_ht        NUMERIC(18,2),
  new_duration_months  INTEGER,
  new_vendor_id        TEXT,
  new_vendor_name      TEXT,
  publication_date     DATE,
  source_hash          TEXT NOT NULL,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_uid, source_hash)
);

CREATE INDEX IF NOT EXISTS france_modifications_contract_uid_idx ON france_modifications (contract_uid);

CREATE TABLE IF NOT EXISTS france_sync_meta (
  id               INTEGER DEFAULT 1 PRIMARY KEY CHECK (id = 1),
  last_modified    TEXT,
  content_length   BIGINT,
  rows_processed   INTEGER,
  rows_inserted    INTEGER,
  rows_updated     INTEGER,
  last_sync_at     TIMESTAMPTZ
);
