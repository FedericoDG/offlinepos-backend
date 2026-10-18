#!/bin/sh
# Pruebas de scripts/deploy.sh: el pre-flight de la imagen nueva antes del swap.
#
# Sin red y sin daemon de Docker: `docker` es un stub en un PATH temporal, asi
# que esto corre igual en el CI del runner. Solo las pruebas 5 y 6 levantan un
# HTTP local con node.
#
# Lo que protege, en orden de importancia:
#   - que el pre-flight NO pueda pasar cuando la imagen esta rota (si el probe se
#     degradara a un `node -e '"..."'` que evalua un string y sale 0, el health
#     check pasaria siempre y nadie se enteraria: por eso la prueba 6 mira el
#     argv exacto);
#   - que si el pre-flight falla, NO se corra ni migracion ni `up` (el stack que
#     esta sirviendo tiene que quedar intacto);
#   - que el trap borre siempre los contenedores de prueba.
set -u
RAIZ=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEPLOY="$RAIZ/scripts/deploy.sh"
WS=$(mktemp -d) || exit 1
trap 'rm -rf "$WS"' EXIT
BIN="$WS/bin"; mkdir -p "$BIN" "$WS"/st
export LOG="$WS/argv.log" STUB_STATE="$WS/st" PATH="$BIN:$PATH"
# sleep REAL: el de $BIN es un stub instantaneo y las esperas de la prueba 5 lo necesitan
RESLEEP=$(command -v -p sleep 2>/dev/null || echo /bin/sleep)
: > "$LOG"

cat > "$BIN/docker" <<'STUB'
#!/bin/sh
{ printf 'docker'; for a in "$@"; do printf ' [%s]' "$a"; done; printf '\n'; } >> "$LOG"
if [ "$1" = "compose" ]; then
  shift; while [ "$#" -gt 0 ]; do case "$1" in -f|--profile) shift 2 ;; *) break ;; esac; done
  sub=$1; shift; printf 'compose:%s\n' "$sub" >> "$STUB_STATE/order.log"
  case "$sub" in
    build) exit "${BUILD_RC:-0}" ;;
    up)    exit "${UP_RC:-0}" ;;
    exec)  printf '%s\n' "$*" >> "$STUB_STATE/cexec.log"; exit "${CEXEC_RC:-0}" ;;
    run)
      case " $* " in
        # El respaldo: el contenedor real escribe el dump, asi que el stub lo
        # imita creando el archivo que el script despues verifica.
        *" respaldos "*) printf 'BACKUP\n' >> "$STUB_STATE/order.log"
          printf '%s\n' "$*" >> "$STUB_STATE/backup.log"
          for a in "$@"; do case "$a" in *"/respaldos/"*.dump*) printf 'contenido-de-prueba' > "$DIR_RESPALDOS/${a##*/}" ;; esac; done
          exit "${BACKUP_RC:-0}" ;;
        *" --rm "*) printf 'MIGRATE\n' >> "$STUB_STATE/order.log"
          printf '%s\n' "$*" >> "$STUB_STATE/migrate.log"; exit "${MIGRATE_RC:-0}" ;;
      esac
      name=""; prev=""; svc=""
      for a in "$@"; do [ "$prev" = "--name" ] && name=$a
        case "$a" in panel-backend|panel-web|landing) svc=$a ;; esac; prev=$a; done
      printf '%s\n' "$*" >> "$STUB_STATE/run.log"
      k=$(printf '%s' "$svc" | tr 'a-z-' 'A-Z_'); rc=0; eval "rc=\${RUN_RC_$k:-0}"
      [ "$rc" = 0 ] || exit "$rc"
      [ -n "$name" ] && : > "$STUB_STATE/up_$name"
      eval "c=\${CRASH_$k:-0}"; [ "$c" = 0 ] || : > "$STUB_STATE/dead_$name"
      exit 0 ;;
    *) exit 0 ;;
  esac
fi
case "$1" in
  inspect) shift 3
    printf '%s\n' "$1" >> "$STUB_STATE/inspect.log"
    if [ -n "${INSPECT_ALWAYS_TRUE:-}" ]; then echo true
    elif [ -f "$STUB_STATE/dead_$1" ]; then echo false; else echo true; fi
    exit 0 ;;
  exec) shift; n=$1; shift
    printf '%s\n' "$n" >> "$STUB_STATE/exec_names.log"
    last=""; for last do :; done; printf '%s' "$last" > "$STUB_STATE/probe_raw.txt"
    m=${EXEC_MODE:-fail}; eval "m=\${EXEC_MODE_$(printf '%s' "$n" | tr 'a-z-' 'A-Z_'):-\$m}"
    case "$m" in real) exec "$@" ;; ok) exit 0 ;; *) exit 1 ;; esac ;;
  logs) echo "(stub) la imagen nueva crasheo"; exit "${LOGS_RC:-0}" ;;
  rm) shift; for a in "$@"; do case "$a" in -f) ;; *) printf '%s\n' "$a" >> "$STUB_STATE/rm.log" ;; esac; done; exit 0 ;;
  *) exit 0 ;;
esac
STUB
printf '#!/bin/sh\necho fakesha\n' > "$BIN/git"
printf '#!/bin/sh\nexit 0\n' > "$BIN/sleep"
chmod +x "$BIN/docker" "$BIN/git" "$BIN/sleep"

OK3="EXEC_MODE_PF_OFFLINEPOS_BACKEND=ok EXEC_MODE_PF_OFFLINEPOS_PANEL=ok EXEC_MODE_PF_OFFLINEPOS_LANDING=ok"
fallos=0
ok()   { echo "  ok    $1"; }
mal()  { echo "  FALLA $1"; fallos=$((fallos+1)); }
ver()  { [ "$2" = "$3" ] && ok "$1 ($3)" || mal "$1: obtuve '$2', esperaba '$3'"; }
correr() { tag=$1; shell=$2; shift 2; S="$WS/$tag"; rm -rf "$S"; mkdir -p "$S" "$S/respaldos"
         STUB_STATE="$S"; export STUB_STATE DIR_RESPALDOS="$S/respaldos"; : > "$LOG"
         env "$@" sh -c "$shell \"$DEPLOY\"" >"$S/out" 2>&1; echo $? >"$S/rc"; }
linea() { grep -n -e "$1" "$LOG" | head -1 | cut -d: -f1; }

echo "== 1) camino feliz: orden pre-flight < migrate < up, 3 probes post-swap, DEPLOY_OK =="
correr f1 "sh" $OK3
ver "sale 0" "$(cat "$WS/f1/rc")" "0"
ver "los 3 pre-flights corrieron" "$(ls "$WS/f1"/up_pf-offlinepos-* 2>/dev/null | wc -l | tr -d ' ')" "3"
pf=$(grep -n '^compose:run$' "$WS/f1/order.log" | cut -d: -f1 | head -3 | tail -1)
bk=$(grep -n '^BACKUP$' "$WS/f1/order.log" | cut -d: -f1); mig=$(grep -n '^MIGRATE$' "$WS/f1/order.log" | cut -d: -f1); up=$(grep -n '^compose:up$' "$WS/f1/order.log" | cut -d: -f1)
if [ -n "$bk" ] && [ -n "$mig" ] && [ -n "$up" ] && [ "$pf" -lt "$bk" ] && [ "$bk" -lt "$mig" ] && [ "$mig" -lt "$up" ]; then
  ok "pre-flight($pf) < respaldo($bk) < migraciones($mig) < up($up)"
else mal "orden: pf=$pf bk=$bk mig=$mig up=$up"; fi
grep -q 'pg_dump' "$WS/f1/backup.log" && ok "el respaldo corre pg_dump" || mal "el respaldo no corrio pg_dump"
grep -q '\[up\] \[-d\] \[--remove-orphans\] \[--wait\] \[--wait-timeout\] \[180\]' "$LOG" && ok "up -d --remove-orphans --wait --wait-timeout 180" || mal "flags de up"
ver "3 health checks post-swap" "$(grep -c '\[exec\] \[-T\]' "$LOG")" "3"
grep -q 'DEPLOY_OK' "$WS/f1/out" && ok "imprime DEPLOY_OK" || mal "no imprime DEPLOY_OK"
grep -q '\[run\] \[--rm\] \[panel-backend\] \[npx\] \[prisma\] \[migrate\] \[deploy\]' "$LOG" && ok "migrate deploy intacto" || mal "migrate deploy cambio"

echo "== 2) pre-flight que falla: exit != 0, sin migrate, sin up, PRE-FLIGHT_FALLO, trap limpio =="
for caso in "panel-backend:CRASH_PANEL_BACKEND=1" "panel-web:CRASH_PANEL_WEB=1" "landing:CRASH_LANDING=1" \
            "panel-web mute:EXEC_MODE_PF_OFFLINEPOS_PANEL=fail"; do
  svc=${caso%%:*}; envset=${caso#*:}
  correr f2 "sh" $OK3 $envset
  rc=$(cat "$WS/f2/rc")
  [ "$rc" != 0 ] && ok "[$svc] exit != 0 ($rc)" || mal "[$svc] salio 0"
  grep -q '^MIGRATE$' "$WS/f2/order.log" && mal "[$svc] corrio migraciones" || ok "[$svc] sin migraciones"
  grep -q 'compose:up' "$WS/f2/order.log" && mal "[$svc] corrio up: produccion tocada" || ok "[$svc] up NO corrio"
  grep -q PRE-FLIGHT_FALLO "$WS/f2/out" && ok "[$svc] avisa PRE-FLIGHT_FALLO" || mal "[$svc] sin aviso"
  [ "$(grep -vc '^pf-' "$WS/f2/rm.log" 2>/dev/null)" = 0 ] && ok "[$svc] el trap solo borro pf-*" || mal "[$svc] el trap borro un nombre ajeno"
done

echo "== 3) inspect miente (running=true) con el contenedor caido -> igual aborta =="
correr f3 "sh" $OK3 CRASH_PANEL_WEB=1 INSPECT_ALWAYS_TRUE=1 EXEC_MODE_PF_OFFLINEPOS_PANEL=fail
rc=$(cat "$WS/f3/rc"); [ "$rc" != 0 ] && ok "exit != 0 ($rc)" || mal "salio 0: falso PASS"
ver "12 intentos" "$(grep -c . "$WS/f3/exec_names.log")" "13"

echo "== 4) 'se apaga sola' corta antes de los 12 intentos =="
correr f4 "sh" $OK3 CRASH_PANEL_WEB=1
ver "1 solo intento (backend ok, panel muerto)" "$(grep -c . "$WS/f4/exec_names.log")" "1"
grep -q 'se apago sola' "$WS/f4/out" && ok "reporta 'se apago sola'" || mal "no detecta el crash"

echo "== 5) el probe REALMENTE hace HTTP (un no-op se veria como exito aca) =="
if command -v node >/dev/null 2>&1; then
  grep '^PROBE_BACKEND=' "$DEPLOY" > "$WS/probe.sh"; . "$WS/probe.sh"
  node -e "require('http').createServer((q,s)=>{s.statusCode=200;s.end('x')}).listen(4311,'127.0.0.1')" >/dev/null 2>&1 &
  Srv=$!; "$RESLEEP" 1
  timeout 10 env PORT=4311 sh -c "$PROBE_BACKEND" >/dev/null 2>&1 && ok "servidor vivo -> 0" || mal "servidor vivo -> != 0"
  timeout 10 env PORT=4399 sh -c "$PROBE_BACKEND" >/dev/null 2>&1 && mal "puerto muerto -> 0 (probe no-op!)" || ok "puerto muerto -> != 0"
  kill $Srv 2>/dev/null
  node -e "require('http').createServer((q,s)=>{s.statusCode=500;s.end('x')}).listen(4312,'127.0.0.1')" >/dev/null 2>&1 &
  Srv2=$!; "$RESLEEP" 1
  timeout 10 env PORT=4312 sh -c "$PROBE_BACKEND" >/dev/null 2>&1 && mal "HTTP 500 -> 0" || ok "HTTP 500 -> != 0"
  kill $Srv2 2>/dev/null
else echo "  --    node no instalado: se omiten 5 (registrar como UNVERIFIED)"; fi

echo "== 6) las comillas NO sobreviven: node recibe -e + el JS como un solo argv =="
mkdir -p "$BIN/f"; cat > "$BIN/f/node" <<'N'
#!/bin/sh
printf 'ARGC=%s\n' "$#" >> "$NODE_LOG"; i=0
for a in "$@"; do i=$((i+1)); printf 'ARG%d=%s\n' "$i" "$a" >> "$NODE_LOG"; done
exit 0
N
chmod +x "$BIN/f/node"
grep '^PROBE_BACKEND=' "$DEPLOY" > "$WS/pb.sh"; NODE_LOG="$WS/node.log"; export NODE_LOG; : > "$NODE_LOG"
PATH="$BIN/f:$PATH" sh -c ". $WS/pb.sh; sh -c \"\$PROBE_BACKEND\""
ver "argc" "$(head -1 "$NODE_LOG" | cut -d= -f2)" "2"
[ "$(sed -n 2p "$NODE_LOG" | cut -d= -f2)" = "-e" ] && ok "arg2 = -e" || mal "arg2 != -e"
grep -q "^ARG2=require('http')" "$NODE_LOG" && ok "arg3 = JS sin comillas (probe real, no string)" || mal "el JS llego con comillas: probe no-op"
unset NODE_LOG

echo "== 7) el trap preserva el codigo de salida bajo sh y bash =="
correr f7a "sh" $OK3 CRASH_PANEL_WEB=1; ver "sh rc" "$(cat "$WS/f7a/rc")" "1"
correr f7b "bash" $OK3 CRASH_PANEL_WEB=1; ver "bash rc" "$(cat "$WS/f7b/rc")" "1"
correr f7c "bash" $OK3; ver "bash camino feliz rc" "$(cat "$WS/f7c/rc")" "0"

echo "== 9) respaldo que falla: aborta antes de migrar y no toca el stack =="
correr f9 "sh" $OK3 BACKUP_RC=1
rc=$(cat "$WS/f9/rc")
[ "$rc" != 0 ] && ok "exit != 0 ($rc)" || mal "salio 0"
grep -q '^MIGRATE$' "$WS/f9/order.log" && mal "migro sin respaldo" || ok "sin migraciones"
grep -q 'compose:up' "$WS/f9/order.log" && mal "corrio up" || ok "up NO corrio"
grep -q RESPALDO_FALLO "$WS/f9/out" && ok "avisa RESPALDO_FALLO" || mal "sin aviso"

echo "== 8) POSIX sh y nombres sin colision con produccion =="
sh -n "$DEPLOY" && ok "sh -n" || mal "sh -n"
if command -v dash >/dev/null 2>&1; then dash -n "$DEPLOY" && ok "dash -n" || mal "dash -n"; fi
prod=$(grep -o 'container_name: .*' "$RAIZ/compose.prod.yml" | awk '{print $2}')
choque=""
for n in $(cat "$WS"/*/rm.log 2>/dev/null "$WS"/*/exec_names.log 2>/dev/null | sort -u); do
  case "$n" in pf-*) ;; *) choque="$choque $n" ;; esac
  for p in $prod; do [ "$n" = "$p" ] && choque="$choque $n(prod)"; done
done
[ -z "$choque" ] && ok "todo nombre tocado es pf-* y no colisiona con produccion" || mal "nombres en conflicto:$choque"

echo
[ "$fallos" = 0 ] && echo "TODO OK" || echo "$fallos FALLAS"
exit "$fallos"
