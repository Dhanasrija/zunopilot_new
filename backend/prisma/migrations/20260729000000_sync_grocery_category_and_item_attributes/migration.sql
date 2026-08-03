-- AlterEnum
BEGIN;
CREATE TYPE "BusinessCategory_new" AS ENUM ('RESTAURANT', 'ECOMMERCE_GROCERY');
ALTER TABLE "Tenant" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "Tenant" ALTER COLUMN "category" TYPE "BusinessCategory_new" USING ("category"::text::"BusinessCategory_new");
ALTER TYPE "BusinessCategory" RENAME TO "BusinessCategory_old";
ALTER TYPE "BusinessCategory_new" RENAME TO "BusinessCategory";
DROP TYPE "BusinessCategory_old";
ALTER TABLE "Tenant" ALTER COLUMN "category" SET DEFAULT 'RESTAURANT';
COMMIT;

-- AlterEnum
ALTER TYPE "TemplateTrigger" ADD VALUE 'ORDER_CREATED';

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "attributes" JSONB;

-- AlterTable
ALTER TABLE "Tenant" ALTER COLUMN "category" SET DEFAULT 'RESTAURANT';

