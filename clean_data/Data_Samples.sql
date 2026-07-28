CREATE TABLE IF NOT EXISTS "ward" (
    "id" INTEGER NOT NULL,
    "parent_id" INTEGER,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "organizational" (
    "id" INTEGER NOT NULL,
    "parent_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("parent_id") REFERENCES "ward" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS "person" (
    "id" INTEGER NOT NULL,
    "parent_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "refUname" TEXT NOT NULL,
    "refFullname" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    PRIMARY KEY ("id"),
    FOREIGN KEY ("parent_id") REFERENCES "organizational" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION
);