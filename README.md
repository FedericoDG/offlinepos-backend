# Backend - Panel de Administración POS

API REST para la administración de licencias, comercios y administradores del sistema POS. Desarrollado con **Node.js**, **Express**, **TypeScript**, **Prisma ORM** y **PostgreSQL (PostGIS)**.

---

## 📋 Requisitos Previos

Asegúrate de tener instaladas las siguientes herramientas en tu entorno de desarrollo:

- [Node.js](https://nodejs.org/) (v18 o superior)
- [Docker](https://www.docker.com/) y [Docker Compose](https://docs.docker.com/compose/)
- [npm](https://www.npmjs.com/) (incluido con Node.js)

---

## ⚙️ 1. Configuración de Variables de Entorno

El proyecto cuenta con **dos archivos `.env.example`** según el contexto de ejecución:

1. **Raíz (`/.env.example`)**: Archivo principal del proyecto.
   - Es utilizado por Docker Compose (`dev.yml`) para configurar el contenedor de PostgreSQL (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`).
   - Es leído por el backend como la fuente primaria de configuración (`PORT`, `JWT_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, `CORS_ORIGIN`, etc.).

2. **Backend (`/backend/.env.example`)**: Archivo complementario/fallback.
   - Contiene la variable `DATABASE_URL` para herramientas de Prisma y ejecuciones directas dentro de la carpeta `backend/`.

### Crear los archivos `.env`:

Desde la raíz del repositorio, ejecuta:

```bash
# 1. Copiar variables de entorno en la raíz
cp .env.example .env

# 2. Copiar variables de entorno en la carpeta backend
cp backend/.env.example backend/.env
```

> 💡 **Nota:** Si modificas las credenciales de PostgreSQL en el `.env` raíz, asegúrate de actualizar la cadena `DATABASE_URL` tanto en `.env` como en `backend/.env`.

---

## 🐳 2. Iniciar la Base de Datos con Docker

El servicio de base de datos utiliza PostgreSQL con la extensión PostGIS y se gestiona mediante el archivo `dev.yml`.

### Iniciar el contenedor:

Desde la **raíz del proyecto**, ejecuta:

```bash
docker compose -f dev.yml up -d
```

### Comandos útiles de Docker:

| Acción | Comando |
| :--- | :--- |
| **Ver estado del contenedor** | `docker compose -f dev.yml ps` |
| **Ver logs de PostgreSQL** | `docker compose -f dev.yml logs -f postgres` |
| **Detener el contenedor** | `docker compose -f dev.yml down` |
| **Detener y borrar datos (volumen)** | `docker compose -f dev.yml down -v` |

---

## 📦 3. Instalación de Dependencias

Ingresa a la carpeta `backend` e instala los paquetes necesarios:

```bash
cd backend
npm install
```

---

## 🗄️ 4. Base de Datos con Prisma (Migraciones y Seeds)

Una vez que el contenedor de PostgreSQL esté activo y en estado saludable (*healthy*), ejecuta los siguientes comandos desde la carpeta `backend`:

### 4.1 Generar el cliente de Prisma:
```bash
npm run db:generate
```

### 4.2 Aplicar migraciones:
Crea las tablas y esquemas necesarios en PostgreSQL:
```bash
npm run db:migrate
```

### 4.3 Poblar la base de datos (Seed):
Inserta los datos iniciales de prueba (administrador, comercio y licencias demo):
```bash
npm run db:seed
```

#### 🔑 Datos sembrados por defecto:
- **Administrador:**
  - **Email:** `federico@mail.com`
  - **Contraseña:** `123456`
  - **Rol:** `ADMINISTRADOR`
- **Comercio:**
  - **Nombre:** `Comercio Central POS`
  - **ID:** `a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d`
- **Licencias Demo:**
  - **Servidor:** `LIC-2026-POS-DEMO-KEY` (Máx. 3 activaciones)
  - **Cliente:** `LIC-2026-CLI-DEMO-KEY` (Máx. 5 activaciones)

### Otros comandos de Prisma:

| Script | Descripción |
| :--- | :--- |
| `npm run db:reset` | Resetea la base de datos por completo y reaplica migraciones |
| `npm run db:studio` | Abre la interfaz visual de Prisma Studio en `http://localhost:5555` |

---

## 🚀 5. Iniciar el Servidor en Modo Desarrollo

Desde la carpeta `backend`, inicia el servidor con recarga automática:

```bash
npm run dev
```

El servidor estará escuchando en:
```text
http://localhost:4000
```

### Probar conectividad:
Puedes verificar el estado del servidor y la base de datos en:
- `GET http://localhost:4000/health`

Respuesta esperada:
```json
{
  "status": "ok",
  "db": "connected",
  "env": "development"
}
```

---

## ⚡ Guía Rápida (TL;DR)

Para iniciar todo desde cero en una sola secuencia de comandos:

```bash
# 1. Configurar variables de entorno
cp .env.example .env
cp backend/.env.example backend/.env

# 2. Levantar PostgreSQL
docker compose -f dev.yml up -d

# 3. Entrar a backend e instalar dependencias
cd backend
npm install

# 4. Preparar base de datos
npm run db:generate
npm run db:migrate
npm run db:seed

# 5. Iniciar en modo desarrollo
npm run dev
```

---

## 📁 Estructura del Proyecto

```text
backend_panel_administracion/
├── .env.example              # Variables de entorno raíz (Docker + Backend)
├── dev.yml                   # Docker Compose para PostgreSQL en desarrollo
├── backend/
│   ├── .env.example          # Variables de entorno locales para backend/Prisma
│   ├── package.json          # Dependencias y scripts de Node.js
│   ├── tsconfig.json         # Configuración de TypeScript
│   ├── prisma.config.ts      # Configuración de Prisma v6
│   ├── prisma/
│   │   ├── schema.prisma     # Modelos de datos
│   │   ├── migrations/       # Historial de migraciones SQL
│   │   ├── seed.ts           # Script principal de sembrado
│   │   └── seeds/            # Datos iniciales modulares
│   └── src/
│       ├── config/           # Carga de variables (env.ts) y cliente Prisma
│       ├── features/         # Módulos: administradores, comercios, licencias
│       ├── middlewares/      # Middlewares (autenticación, validación, errores)
│       ├── utils/            # Utilidades (cifrado AES-256, hashing, JWT)
│       └── index.ts          # Punto de entrada de la aplicación Express
```
