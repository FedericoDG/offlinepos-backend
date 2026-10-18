# Pruebas del panel

Dos suites, cada una prueba una cosa distinta.

## 1. La logica del negocio — `backend/pruebas`

Ejercita los services reales (suscripciones, licencias, pagos, planes,
estadisticas) contra una base falsa en memoria. No necesita Postgres ni Docker.

```bash
cd backend
npx tsx pruebas/correr.ts
```

Son 225 comprobaciones. Ahi viven los casos de borde de vencimiento: el dia
exacto en que vence, los tres dias de gracia, el dia 34, la renovacion desde
una suscripcion viva y desde una ya vencida, el cupo de cada plan.

## 2. El panel de punta a punta — `panel/pruebas`

Abre un navegador de verdad contra el panel compilado y comprueba lo que ve
una persona: los textos, los estados, los filtros, la paginacion, los
dialogos. El backend real no interviene: en su lugar corre
`servidor-simulado.mjs`, que responde los mismos contratos y mantiene estado,
con un comercio por cada estado de vencimiento.

### Preparar (una sola vez)

```bash
cd panel
npm i -D playwright
npx playwright install chromium
```

### Correr

Hacen falta tres cosas prendidas: el simulado, el panel compilado apuntando al
simulado, y despues la suite.

```bash
# terminal 1 — el backend simulado
SIM_PORT=4001 node pruebas/servidor-simulado.mjs   # escucha en :4001
# (el 4000 lo ocupa el backend de desarrollo; sin SIM_PORT usa 4000)

# terminal 2 — el panel compilado contra el simulado
npm run build
BACKEND_URL=http://localhost:4001 PORT=3000 npm start   # escucha en :3000

# terminal 3 — las pruebas (el panel vive bajo /admin)
PANEL_URL=http://localhost:3000/admin API_URL=http://localhost:4001 \
  node pruebas/panel.prueba.mjs
```

En Windows (PowerShell), la segunda es:

```powershell
$env:BACKEND_URL="http://localhost:4000"; npm start
```

Son 63 comprobaciones. Deja capturas de pantalla en `pruebas/capturas/`.

La suite se puede correr las veces que haga falta sin reiniciar el simulado:
lo primero que hace es pedirle `/__reiniciar`, que lo deja como al arranque.

### Variables opcionales

| Variable    | Para que                                                     |
|-------------|--------------------------------------------------------------|
| `PANEL_URL` | Donde escucha el panel. Por defecto `http://localhost:3000`.  |
| `API_URL`   | Donde escucha el simulado. Por defecto `http://localhost:4000`.|
| `CAPTURAS`  | Carpeta de las capturas. Por defecto `pruebas/capturas`.       |
| `CHROMIUM`  | Ruta a un Chromium propio, si Playwright no trajo el suyo.     |

### Que casos cubre

- **Sesion**: sin login no se entra a ninguna ruta privada y se recuerda a
  donde queria ir; contrasena mala muestra "credenciales invalidas" y no
  "sesion vencida"; ya logueado, `/login` redirige al panel; 404 propio.
- **Dashboard**: comercios, licencias servidor activas, planes activos, consumo
  de chat, y la tabla de comercios con su plan directo.
- **Claves** (`/licencias`): buscador y paginacion contra el backend, clave
  suspendida por bajar de plan, generacion de claves sueltas (el cupo se
  controla al asignar, no al generar), y el cambio de PC (liberar la
  instalacion vieja con confirmacion).
- **Comercios**: plan directo, cupo de servidores y deuda estimada; alta en un
  paso (`/comercios/alta`) con plan y claves libres, incluido el rechazo
  cuando se asignan mas claves que el cupo ("mejora el plan") y la
  confirmacion de que quedo asociado.
- **Planes**: cupo de servidores, cupo de chat, precios, comercios con este
  plan, plan discontinuado, y el aviso de que editar un plan no afecta a los
  ya contratados.
- Las pantallas de suscripciones y cobranza se quitaron del panel en el
  rediseno (commit d8bf4e1, 2026-10-07: ya no existen `/suscripciones` ni
  `/pagos`). Esas reglas —vencimiento, dias de gracia, cobros y deuda— siguen
  cubiertas en `backend/pruebas` (casos de borde de vencimiento y cobranza).
- **Backend caido**: se corta el simulado a proposito y se comprueba que el
  panel muestre un error entendible en vez de romperse, y que se recupere
  solo cuando el backend vuelve.
- **Errores de JavaScript**: se juntan durante toda la corrida y tienen que
  ser cero, fuera de los del corte provocado.
