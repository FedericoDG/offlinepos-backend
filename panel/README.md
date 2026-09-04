# Panel de administración — Binario Dev Labs

Panel web para administrar el sistema POS: estadísticas de ingreso mensual,
próximos vencimientos, emisión de licencias para comercios y ABM de los tipos
de suscripción.

Está hecho con **Next.js 16 (App Router)**, **React 19**, **Tailwind v4** y
**Recharts**, y consume la API Express que vive en `../backend`.

---

## Puesta en marcha

El panel no funciona solo: necesita el backend y la base de datos levantados.
El orden es siempre el mismo.

### 1. Base de datos y backend

Desde la raíz del repositorio:

```bash
docker compose -f dev.yml up -d

cd backend
npm install
npm run db:generate
npm run db:migrate          # aplica también la migración de planes/suscripciones/pagos
npx tsx prisma/seed-panel.ts   # crea los admins de Binario y los planes Básico y Pro
npm run dev                 # queda escuchando en http://localhost:4000
```

> `prisma/seed-panel.ts` es **aditivo**: usa `upsert` y no borra nada, así que
> se puede correr sobre una base con datos reales. Con `--demo` agrega además
> cinco comercios y seis meses de pagos de muestra, para ver el dashboard con
> forma antes de tener clientes:
>
> ```bash
> npx tsx prisma/seed-panel.ts --demo
> ```

### 2. El panel

En otra terminal:

```bash
cd panel
cp .env.example .env.local
npm install
npm run dev                 # http://localhost:3000
```

### 3. Entrar

| Usuario | Contraseña |
| :--- | :--- |
| `federico@binario.com` | `123456` |
| `joaquin@binario.com` | `123456` |

---

## Variables de entorno

`panel/.env.local`:

| Variable | Para qué |
| :--- | :--- |
| `BACKEND_URL` | URL del backend Express. Por defecto `http://localhost:4000`. |
| `SESSION_COOKIE_NAME` | Nombre de la cookie de sesión. Por defecto `binario_panel_session`. |

---

## Cómo está armado

```text
panel/
├── src/
│   ├── proxy.ts              # portero: sin cookie no se entra a nada salvo /login
│   ├── fonts/                # Space Grotesk, Inter y JetBrains Mono, locales
│   ├── app/
│   │   ├── login/            # ingreso contra POST /api/administradores/login
│   │   └── (panel)/          # todo lo que requiere sesión
│   │       ├── dashboard/    # KPIs, ingreso mensual, próximos vencimientos
│   │       ├── comercios/    # alta de comercio + su primera licencia
│   │       ├── licencias/    # licencias emitidas, con la clave a la vista
│   │       ├── suscripciones/# contratos: renovar, editar, cancelar
│   │       ├── planes/       # Básico y Pro: precios y cupos
│   │       └── pagos/        # cobranza registrada
│   ├── actions/              # server actions (mutaciones)
│   ├── lib/
│   │   ├── api.ts            # cliente del backend, con el token de la cookie
│   │   ├── consultas.ts      # lecturas
│   │   ├── sesion.ts         # cookie httpOnly
│   │   └── formato.ts        # plata, fechas y vencimientos en es-AR
│   └── components/
└── public/logo-mark.svg
```

### Cómo se dan de alta los comercios

El alta es en **dos pasos**, y el orden importa:

1. **Comercios → Nuevo comercio**: solo el nombre. Nace sin licencias y sin plan.
2. **Suscripciones → Nueva suscripción**: al contratar el plan se emiten solas
   las licencias que ese plan declara (Básico: 1 servidor; Pro: 1 servidor + 2
   clientes) y se asienta el **primer pago**, todo en la misma transacción.
   Contratar da por hecho que el comercio pagó: si no pagó, no se le contrata.

Cambiar de plan reajusta el cupo sin intervención: subir a Pro emite las
licencias de cliente que falten, bajar a Básico suspende las que sobren. Al
suspender elige con criterio —primero las que nunca se activaron, y entre las
activadas, las más nuevas— para no apagarle al comercio la caja que viene
usando hace un año. Si después vuelve a subir de plan, **reactiva las mismas
licencias** en vez de emitir claves nuevas, así el comercio sigue usando la que
ya tenía anotada.

`Licencias → Emitir licencia suelta` queda para casos excepcionales, pero el
cupo del plan se hace cumplir: el backend rechaza emitir un cliente en Básico
o un tercer cliente en Pro, y pide mejorar el plan. El panel se adelanta y
deshabilita el botón con el mismo motivo, para no mandar un formulario que ya
sabemos que vuelve rechazado.

Los listados de **Licencias** y **Pagos** se paginan en el backend (20 por
página) y se filtran por nombre de comercio con el buscador. El filtro y la
página viven en la URL, así que el link se puede compartir y sobrevive a un
refresh. En Pagos, el total que se muestra arriba es la suma de **todo lo
filtrado**, no solo de la página visible.

Una licencia en estado `suspendida` es una que el plan actual ya no cubre.

**Si el comercio cambia de PC**, no se le emite una clave nueva: en
`Licencias → Instalaciones` se libera la máquina vieja. Eso borra su activación
y le devuelve el cupo a la licencia, así que la misma clave se puede activar en
la máquina nueva y el cupo del plan no se mueve. Emitir un reemplazo sería la
salida equivocada: dejaría al comercio con dos licencias activas para un plan
que cubre una sola.

Un detalle de tiempos: conviene liberar justo antes de que el comercio active
la máquina nueva. Si la vieja sigue encendida y con internet, en su próxima
revalidación el backend la trata como una instalación nueva y vuelve a tomar el
puesto que se acaba de soltar.

### Dos decisiones que conviene conocer

**El navegador nunca ve el token.** El login guarda el JWT del backend en una
cookie `httpOnly` y todas las llamadas a la API salen del servidor de Next
(server components y server actions). Por eso el panel tampoco necesita estar
en `CORS_ORIGIN`: no le pega al backend desde el navegador.

**El estado de una suscripción se calcula al leer.** El backend guarda el
estado que se decidió a mano (`ACTIVA`, `CANCELADA`) y devuelve además un
`estado_efectivo` que compara `vence_en` contra hoy y contra los días de
gracia, definidos en `backend/src/features/suscripcion/suscripcion.reglas.ts`
(por defecto 3; la variable de entorno `DIAS_GRACIA` los pisa si hace falta).
No hay tarea programada que pueda dejar de correr y mostrar como al día a un
comercio que debe.

---

## Identidad visual

La interfaz es **shadcn/ui** (estilo `new-york`) con la paleta de Binario Dev
Labs. Los tokens estan en `src/app/globals.css` con los nombres que usa shadcn,
asi que cualquier componente que agregues despues con el CLI entra sin
retoques:

```bash
npx shadcn@latest add dropdown-menu
```

Lo unico que cambia respecto de shadcn de fabrica son los valores:

| Token de shadcn | Valor | De donde sale |
| :--- | :--- | :--- |
| `--background` | `#0a0a0a` | Fondo de la marca |
| `--foreground` | `#f2f2ed` | Tinta de la marca |
| `--primary` | `#3b82f6` | Azul de la marca |
| `--border` | `#262623` | Filete de la marca, un punto mas claro |
| `--chart-1..5` | familia azul | Una sola familia: el panel muestra plata, no categorias sin relacion |

El panel es oscuro siempre: la clase `dark` va fija en `<html>` y `:root` ya
trae los valores oscuros, asi que no hay tema claro que mantener sincronizado.

Inter para toda la interfaz (es la que asume la escala tipografica de shadcn) y
JetBrains Mono para claves y cifras. **Space Grotesk queda reservada al nombre
de la marca**: es parte del logo, no de la UI. Las tres van locales en
`src/fonts/` y no desde Google Fonts, para que el panel abra igual en una
maquina sin internet.

El logo (`public/logo-mark.svg` y `components/marca/logo.tsx`) es el mismo que
sirve binariodevlabs.com, con las esquinas redondeadas al radio de shadcn.

---

## Scripts

| Script | Qué hace |
| :--- | :--- |
| `npm run dev` | Desarrollo en `http://localhost:3000` |
| `npm run build` | Build de producción |
| `npm start` | Sirve el build |
| `npm run typecheck` | `tsc --noEmit` |
