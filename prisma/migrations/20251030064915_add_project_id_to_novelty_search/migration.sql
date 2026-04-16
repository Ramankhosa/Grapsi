-- AlterTable
ALTER TABLE "novelty_search_runs" ADD COLUMN     "projectId" TEXT;

-- AddForeignKey
ALTER TABLE "novelty_search_runs" ADD CONSTRAINT "novelty_search_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
