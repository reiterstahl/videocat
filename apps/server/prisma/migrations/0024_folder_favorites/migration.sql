-- CreateTable
CREATE TABLE "FolderFavorite" (
    "id" UUID NOT NULL,
    "diskId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolderFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FolderFavorite_diskId_path_key" ON "FolderFavorite"("diskId", "path");

-- AddForeignKey
ALTER TABLE "FolderFavorite" ADD CONSTRAINT "FolderFavorite_diskId_fkey" FOREIGN KEY ("diskId") REFERENCES "Disk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
