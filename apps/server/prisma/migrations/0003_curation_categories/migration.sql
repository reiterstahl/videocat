CREATE TABLE "CurationCategory" (
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "builtIn" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CurationCategory_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "CurationCategory_builtIn_idx" ON "CurationCategory"("builtIn");
CREATE INDEX "CurationCategory_label_idx" ON "CurationCategory"("label");

INSERT INTO "CurationCategory" ("key", "label", "color", "builtIn", "updatedAt")
VALUES
  ('review', 'Por revisar', '#E1AD16', true, CURRENT_TIMESTAMP),
  ('delete', 'Marcado para borrar', '#D94538', true, CURRENT_TIMESTAMP),
  ('sh', 'SH', '#2A9FD6', true, CURRENT_TIMESTAMP);
