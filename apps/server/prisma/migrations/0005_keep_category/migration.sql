INSERT INTO "CurationCategory" ("key", "label", "color", "builtIn", "updatedAt")
VALUES ('keep', 'Mantener', '#20A464', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "label" = EXCLUDED."label",
    "color" = EXCLUDED."color",
    "builtIn" = EXCLUDED."builtIn",
    "updatedAt" = CURRENT_TIMESTAMP;
