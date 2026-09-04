# Pruebas del panel

Dos suites, cada una prueba una cosa distinta.

## 1. La logica del negocio — `backend/pruebas`

Ejercita los services reales (suscripciones, licencias, pagos, planes,
estadisticas) contra una base falsa en memoria. No necesita Postgres ni Docker.

```bash
cd backend
npx tsx pruebas/correr.ts
```

Son 141 comprobaciones. Ahi viven los casos de borde de vencimiento: el dia
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
node pruebas/servidor-simulado.mjs        # escucha en :4000

# terminal 2 — el panel compilado contra el simulado
npm run build
BACKEND_URL=http://localhost:4000 npm start   # escucha en :3000

# terminal 3 — las pruebas
node pruebas/panel.prueba.mjs
```

En Windows (PowerShell), la segunda es:

```powershell
$env:BACKEND_URL="http://localhost:4000"; npm start
```

Son 82 comprobaciones. Deja capturas de pantalla en `pruebas/capturas/`.

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
- **Dashboard**: los cuatro numeros de arriba, la plata en pesos, el grafico
  de doce meses, el reparto por plan, y los proximos vencimientos ordenados
  del mas urgente al menos.
- **Vencimientos**, un comercio por caso: al dia (+20 dias), vence pronto
  (+3), vence hoy, en gracia (-2), pasada la gracia (-40), cancelada, y uno
  sin plan. Se comprueba el estado, el texto de dias y que acciones se
  ofrecen (a la cancelada no se le ofrece Renovar sino Reactivar).
- **Filtros por estado** en suscripciones.
- **Licencias**: buscador y paginacion contra el backend, licencia suspendida
  por bajar de plan, cupo del plan agotado (con el aviso de mejorar el plan),
  comercio sin plan, y el cambio de PC (liberar la instalacion vieja).
- **Comercios**: alta sin plan, y que se explique que las licencias las emite
  la suscripcion.
- **Planes**: cupos, precios, plan discontinuado, y el aviso de que editar un
  plan no afecta a los ya contratados.
- **Cobranza**: total del filtro (no de la pagina visible), buscador,
  paginacion.
- **Backend caido**: se corta el simulado a proposito y se comprueba que el
  panel muestre un error entendible en vez de romperse, y que se recupere
  solo cuando el backend vuelve.
- **Errores de JavaScript**: se juntan durante toda la corrida y tienen que
  ser cero, fuera de los del corte provocado.
