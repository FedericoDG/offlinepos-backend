-- Ola "solo servidor": el tipo de licencia CLIENTE desaparece. Los terminales
-- cliente ya no son un producto, asi que sus claves y todo lo que cuelga de
-- ellas (activaciones y consumos de chat) se borran. Ambos FK son ON DELETE
-- CASCADE, verificado en pg_constraint antes de escribir esta migracion.
DELETE FROM "Licencia" WHERE "rol" = 'CLIENTE';

-- Postgres no permite quitar valores de un enum in place: se renombra el viejo,
-- se crea el nuevo con SERVIDOR solo y se reescribe la columna. El DROP DEFAULT
-- es obligatorio porque el default viejo referencia el tipo renombrado.
ALTER TYPE "RolLicencia" RENAME TO "RolLicencia_old";
CREATE TYPE "RolLicencia" AS ENUM ('SERVIDOR');
ALTER TABLE "Licencia" ALTER COLUMN "rol" DROP DEFAULT;
ALTER TABLE "Licencia" ALTER COLUMN "rol" TYPE "RolLicencia" USING ("rol"::text::"RolLicencia");
ALTER TABLE "Licencia" ALTER COLUMN "rol" SET DEFAULT 'SERVIDOR';
DROP TYPE "RolLicencia_old";

-- El cupo de clientes del plan deja de tener sentido sin el rol.
ALTER TABLE "Plan" DROP COLUMN "max_clientes";
