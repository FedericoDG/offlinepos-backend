import { NextResponse, type NextRequest } from 'next/server';

const NOMBRE_COOKIE = process.env.SESSION_COOKIE_NAME || 'binario_panel_session';

/**
 * Portero del panel (convencion `proxy` de Next 16). Solo mira si hay cookie: la validez real del token la
 * decide el backend en cada llamada, y si respondio 401 el cliente de la API
 * ya manda a /login. Aca alcanza con no dibujar un dashboard vacio a alguien
 * que nunca se logueo.
 */
export default function proxy(request: NextRequest) {
  const tieneSesion = Boolean(request.cookies.get(NOMBRE_COOKIE)?.value);
  const { pathname } = request.nextUrl;
  const esLogin = pathname === '/login';

  if (!tieneSesion && !esLogin) {
    const destino = new URL('/login', request.url);
    if (pathname !== '/') destino.searchParams.set('volver', pathname);
    return NextResponse.redirect(destino);
  }

  if (tieneSesion && esLogin) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|logo-mark.svg).*)'],
};
