-- AlterTable
ALTER TABLE "related_art_selections" ADD COLUMN     "assignees" TEXT[],
ADD COLUMN     "cpcCodes" TEXT[],
ADD COLUMN     "inventors" TEXT[],
ADD COLUMN     "ipcCodes" TEXT[],
ADD COLUMN     "publicationDate" TEXT;
