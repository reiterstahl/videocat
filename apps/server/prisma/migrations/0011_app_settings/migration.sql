CREATE TABLE "AppSetting" (
  "key" text PRIMARY KEY,
  "value" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

