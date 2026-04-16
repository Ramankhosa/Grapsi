-- AlterTable
ALTER TABLE "idea_records" ADD COLUMN     "abstract" TEXT,
ADD COLUMN     "cpcCodes" TEXT[],
ADD COLUMN     "ipcCodes" TEXT[];
