-- AlterEnum
CREATE TYPE "RolLicencia" AS ENUM ('SERVIDOR', 'CLIENTE');

-- AlterTable
ALTER TABLE "Licencia" ADD COLUMN "rol" "RolLicencia" NOT NULL DEFAULT 'SERVIDOR';